package protocol

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"octobus/internal/accesslog"
	"octobus/internal/daemonlog"
	"octobus/internal/descriptors"
	"octobus/internal/store"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection/grpc_reflection_v1"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

type ReflectionServer struct {
	grpc_reflection_v1.UnimplementedServerReflectionServer
	Store        *store.Store
	AccessLogger accessLogger
	Logger       *slog.Logger

	mu         sync.Mutex
	indexCache map[string]*reflectionIndex
}

func (s *ReflectionServer) ServerReflectionInfo(stream grpc_reflection_v1.ServerReflection_ServerReflectionInfoServer) (err error) {
	start := time.Now()
	md, _ := metadata.FromIncomingContext(stream.Context())
	capsetID := firstMD(md, "x-octobus-capset")
	if capsetID == "" {
		return status.Error(codes.InvalidArgument, "reflection requires x-octobus-capset")
	}
	record := accesslog.Record{
		Protocol:   "grpc_reflection",
		Capset:     capsetID,
		Route:      "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo",
		RemoteAddr: grpcRemoteAddr(stream.Context()),
		UserAgent:  firstMD(md, "user-agent"),
	}
	defer func() {
		record.GRPCCode = status.Code(err).String()
		record.DurationMS = time.Since(start).Milliseconds()
		s.appendAccessLog(record)
		s.logProtocolFailure(record)
	}()
	if err := s.authorize(stream.Context(), capsetID); err != nil {
		return err
	}
	index, err := s.index(stream.Context(), capsetID)
	if err != nil {
		if err == sql.ErrNoRows {
			return status.Error(codes.NotFound, "capset not found")
		}
		return status.Error(codes.Internal, err.Error())
	}
	for {
		req, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		resp := &grpc_reflection_v1.ServerReflectionResponse{ValidHost: req.GetHost(), OriginalRequest: req}
		switch x := req.GetMessageRequest().(type) {
		case *grpc_reflection_v1.ServerReflectionRequest_ListServices:
			var names []string
			for name := range index.services {
				names = append(names, name)
			}
			sort.Strings(names)
			list := &grpc_reflection_v1.ListServiceResponse{}
			for _, name := range names {
				list.Service = append(list.Service, &grpc_reflection_v1.ServiceResponse{Name: name})
			}
			resp.MessageResponse = &grpc_reflection_v1.ServerReflectionResponse_ListServicesResponse{ListServicesResponse: list}
		case *grpc_reflection_v1.ServerReflectionRequest_FileContainingSymbol:
			file := index.symbolToFile[x.FileContainingSymbol]
			if file == "" {
				resp.MessageResponse = reflectionError(codes.NotFound, "symbol not found")
			} else {
				resp.MessageResponse = &grpc_reflection_v1.ServerReflectionResponse_FileDescriptorResponse{FileDescriptorResponse: &grpc_reflection_v1.FileDescriptorResponse{FileDescriptorProto: index.closure(file)}}
			}
		case *grpc_reflection_v1.ServerReflectionRequest_FileByFilename:
			if _, ok := index.files[x.FileByFilename]; !ok {
				resp.MessageResponse = reflectionError(codes.NotFound, "file not found")
			} else {
				resp.MessageResponse = &grpc_reflection_v1.ServerReflectionResponse_FileDescriptorResponse{FileDescriptorResponse: &grpc_reflection_v1.FileDescriptorResponse{FileDescriptorProto: index.closure(x.FileByFilename)}}
			}
		default:
			resp.MessageResponse = reflectionError(codes.Unimplemented, "reflection request is not supported")
		}
		if err := stream.Send(resp); err != nil {
			return err
		}
	}
}

func (s *ReflectionServer) appendAccessLog(record accesslog.Record) {
	if s == nil || s.AccessLogger == nil {
		return
	}
	if err := s.AccessLogger.Append(record); err != nil {
		s.logger().Error("access_log_write_failed", "error", err)
	}
}

func (s *ReflectionServer) logProtocolFailure(record accesslog.Record) {
	code := parseGRPCCode(record.GRPCCode)
	if code == codes.OK {
		return
	}
	args := []any{
		"protocol", record.Protocol,
		"capset", record.Capset,
		"service", record.Service,
		"instance", record.Instance,
		"method", record.Method,
		"tool", record.Tool,
		"route", record.Route,
		"http_status", record.HTTPStatus,
		"grpc_code", record.GRPCCode,
		"duration_ms", record.DurationMS,
	}
	if protocolFailureLevel(code, record.HTTPStatus) == slog.LevelError {
		s.logger().Error("protocol_request_failed", args...)
		return
	}
	s.logger().Warn("protocol_request_failed", args...)
}

func (s *ReflectionServer) logger() *slog.Logger {
	if s == nil {
		return daemonlog.Nop()
	}
	return daemonlog.OrNop(s.Logger)
}

func (s *ReflectionServer) authorize(ctx context.Context, capsetID string) error {
	md, _ := metadata.FromIncomingContext(ctx)
	return authorizeCapsetBearer(ctx, s.Store, capsetID, bearerToken(firstMD(md, "authorization")))
}

type reflectionIndex struct {
	files        map[string]*descriptorpb.FileDescriptorProto
	symbolToFile map[string]string
	services     map[string]bool
	closures     map[string][][]byte
}

func (s *ReflectionServer) index(ctx context.Context, capsetID string) (*reflectionIndex, error) {
	items, err := s.Store.ListExposedMethods(ctx, capsetID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, sql.ErrNoRows
	}
	cacheKey := reflectionIndexCacheKey(capsetID, items)
	s.mu.Lock()
	if cached := s.indexCache[cacheKey]; cached != nil {
		s.mu.Unlock()
		return cached, nil
	}
	s.mu.Unlock()

	idx := &reflectionIndex{files: map[string]*descriptorpb.FileDescriptorProto{}, symbolToFile: map[string]string{}, services: map[string]bool{}, closures: map[string][][]byte{}}
	descriptorSets := map[string]*descriptorpb.FileDescriptorSet{}
	allowedFiles := map[string]map[string]bool{}
	exposedMethods := map[string]map[string]bool{}
	for _, item := range items {
		idx.services[item.Method.ServiceFullName] = true
		if exposedMethods[item.Method.ServiceFullName] == nil {
			exposedMethods[item.Method.ServiceFullName] = map[string]bool{}
		}
		exposedMethods[item.Method.ServiceFullName][item.Method.Name] = true
		set := descriptorSets[item.Service.DescriptorPath]
		if set == nil {
			loaded, err := descriptors.Load(item.Service.DescriptorPath)
			if err != nil {
				return nil, err
			}
			set = loaded
			descriptorSets[item.Service.DescriptorPath] = set
		}
		if allowedFiles[item.Service.DescriptorPath] == nil {
			allowedFiles[item.Service.DescriptorPath] = map[string]bool{}
		}
		collectFileClosure(set, item.Method.ProtoFile, allowedFiles[item.Service.DescriptorPath])
	}
	for path, set := range descriptorSets {
		allowed := allowedFiles[path]
		for _, file := range set.GetFile() {
			if !allowed[file.GetName()] {
				continue
			}
			idx.files[file.GetName()] = pruneReflectionFile(file, exposedMethods)
			pkg := file.GetPackage()
			for _, svc := range file.GetService() {
				full := joinSymbol(pkg, svc.GetName())
				methods := exposedMethods[full]
				if len(methods) == 0 {
					continue
				}
				idx.symbolToFile[full] = file.GetName()
				for _, method := range svc.GetMethod() {
					if methods[method.GetName()] {
						idx.symbolToFile[full+"."+method.GetName()] = file.GetName()
					}
				}
			}
			for _, msg := range file.GetMessageType() {
				idx.symbolToFile[joinSymbol(pkg, msg.GetName())] = file.GetName()
			}
		}
	}
	s.mu.Lock()
	if s.indexCache == nil {
		s.indexCache = map[string]*reflectionIndex{}
	}
	s.indexCache[cacheKey] = idx
	s.mu.Unlock()
	return idx, nil
}

func reflectionIndexCacheKey(capsetID string, items []store.ExposedMethod) string {
	var b strings.Builder
	b.WriteString(capsetID)
	for _, item := range items {
		b.WriteByte('\n')
		b.WriteString(item.CapsetInstance.ID)
		b.WriteByte('|')
		b.WriteString(item.CapsetMethod.ID)
		b.WriteByte('|')
		b.WriteString(item.Service.DescriptorSHA256)
		b.WriteByte('|')
		b.WriteString(item.Service.DescriptorVersion)
		b.WriteByte('|')
		b.WriteString(item.Method.FullName)
		b.WriteByte('|')
		b.WriteString(item.Method.ProtoFile)
	}
	return b.String()
}

func pruneReflectionFile(file *descriptorpb.FileDescriptorProto, exposedMethods map[string]map[string]bool) *descriptorpb.FileDescriptorProto {
	pruned := proto.Clone(file).(*descriptorpb.FileDescriptorProto)
	services := pruned.Service[:0]
	for _, svc := range pruned.Service {
		full := joinSymbol(pruned.GetPackage(), svc.GetName())
		methods := exposedMethods[full]
		if len(methods) == 0 {
			continue
		}
		keptMethods := svc.Method[:0]
		for _, method := range svc.Method {
			if methods[method.GetName()] {
				keptMethods = append(keptMethods, method)
			}
		}
		if len(keptMethods) == 0 {
			continue
		}
		svc.Method = keptMethods
		services = append(services, svc)
	}
	pruned.Service = services
	return pruned
}

func collectFileClosure(set *descriptorpb.FileDescriptorSet, name string, out map[string]bool) {
	files := map[string]*descriptorpb.FileDescriptorProto{}
	for _, file := range set.GetFile() {
		files[file.GetName()] = file
	}
	var visit func(string)
	visit = func(fileName string) {
		if out[fileName] {
			return
		}
		file := files[fileName]
		if file == nil {
			return
		}
		out[fileName] = true
		for _, dep := range file.Dependency {
			visit(dep)
		}
	}
	visit(name)
}

func (idx *reflectionIndex) closure(file string) [][]byte {
	if cached := idx.closures[file]; cached != nil {
		return cloneBytesList(cached)
	}
	seen := map[string]bool{}
	var out [][]byte
	var visit func(string)
	visit = func(name string) {
		if seen[name] {
			return
		}
		f := idx.files[name]
		if f == nil {
			return
		}
		seen[name] = true
		for _, dep := range f.Dependency {
			visit(dep)
		}
		b, err := proto.Marshal(f)
		if err == nil {
			out = append(out, b)
		}
	}
	visit(file)
	idx.closures[file] = cloneBytesList(out)
	return cloneBytesList(out)
}

func cloneBytesList(in [][]byte) [][]byte {
	out := make([][]byte, len(in))
	for i, b := range in {
		out[i] = append([]byte(nil), b...)
	}
	return out
}

func reflectionError(code codes.Code, msg string) *grpc_reflection_v1.ServerReflectionResponse_ErrorResponse {
	return &grpc_reflection_v1.ServerReflectionResponse_ErrorResponse{ErrorResponse: &grpc_reflection_v1.ErrorResponse{ErrorCode: int32(code), ErrorMessage: msg}}
}

func joinSymbol(pkg, name string) string {
	return strings.Trim(strings.Join([]string{pkg, name}, "."), ".")
}
