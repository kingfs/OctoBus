package descriptors

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"octobus/internal/domain"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

type CompileRequest struct {
	PackageDir     string
	ProtoRoots     []string
	ProtoFiles     []string
	DescriptorPath string
}

type CompileResult struct {
	DescriptorSHA256  string
	DescriptorVersion string
	Methods           []domain.Method
	Files             *descriptorpb.FileDescriptorSet
}

func Compile(req CompileRequest) (CompileResult, error) {
	if req.PackageDir == "" || req.DescriptorPath == "" {
		return CompileResult{}, fmt.Errorf("package dir and descriptor path are required")
	}
	if len(req.ProtoRoots) == 0 || len(req.ProtoFiles) == 0 {
		return CompileResult{}, fmt.Errorf("proto roots and files are required")
	}
	if err := os.MkdirAll(filepath.Dir(req.DescriptorPath), 0o755); err != nil {
		return CompileResult{}, err
	}

	args := []string{"--include_imports", "--include_source_info", "--descriptor_set_out=" + req.DescriptorPath}
	for _, root := range req.ProtoRoots {
		args = append(args, "-I"+filepath.Join(req.PackageDir, root))
	}
	for _, file := range req.ProtoFiles {
		args = append(args, filepath.Join(req.PackageDir, file))
	}
	cmd := exec.Command("protoc", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return CompileResult{}, fmt.Errorf("compile proto descriptor: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	raw, err := os.ReadFile(req.DescriptorPath)
	if err != nil {
		return CompileResult{}, err
	}
	set := &descriptorpb.FileDescriptorSet{}
	if err := proto.Unmarshal(raw, set); err != nil {
		return CompileResult{}, fmt.Errorf("parse descriptor set: %w", err)
	}
	sha := domain.HashBytes(raw)
	return CompileResult{
		DescriptorSHA256:  sha,
		DescriptorVersion: domain.DescriptorVersion(sha),
		Methods:           MethodsFromSet(set),
		Files:             set,
	}, nil
}

func MethodsFromSet(set *descriptorpb.FileDescriptorSet) []domain.Method {
	var out []domain.Method
	for _, file := range set.GetFile() {
		pkg := file.GetPackage()
		for _, svc := range file.GetService() {
			serviceName := svc.GetName()
			fullService := serviceName
			if pkg != "" {
				fullService = pkg + "." + serviceName
			}
			for _, method := range svc.GetMethod() {
				clientStreaming := method.GetClientStreaming()
				serverStreaming := method.GetServerStreaming()
				out = append(out, domain.Method{
					FullName:        fullService + "/" + method.GetName(),
					ServiceFullName: fullService,
					Name:            method.GetName(),
					InputFullName:   trimType(method.GetInputType()),
					OutputFullName:  trimType(method.GetOutputType()),
					ClientStreaming: clientStreaming,
					ServerStreaming: serverStreaming,
					Unary:           !clientStreaming && !serverStreaming,
					ProtoFile:       file.GetName(),
				})
			}
		}
	}
	return out
}

func Load(path string) (*descriptorpb.FileDescriptorSet, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	set := &descriptorpb.FileDescriptorSet{}
	if err := proto.Unmarshal(raw, set); err != nil {
		return nil, err
	}
	return set, nil
}

func MarshalMethods(methods []domain.Method) (string, error) {
	b, err := json.Marshal(methods)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func UnmarshalMethods(raw string) ([]domain.Method, error) {
	var methods []domain.Method
	if raw == "" {
		return methods, nil
	}
	if err := json.Unmarshal([]byte(raw), &methods); err != nil {
		return nil, err
	}
	return methods, nil
}

func trimType(s string) string {
	return strings.TrimPrefix(s, ".")
}
