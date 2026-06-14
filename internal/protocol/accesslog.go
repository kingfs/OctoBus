package protocol

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"octobus/internal/accesslog"
	"octobus/internal/daemonlog"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

type accessLogger interface {
	Append(accesslog.Record) error
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func newStatusRecorder(w http.ResponseWriter) *statusRecorder {
	return &statusRecorder{ResponseWriter: w}
}

func (w *statusRecorder) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *statusRecorder) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusRecorder) Status() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}

func (w *statusRecorder) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *statusRecorder) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (g *Gateway) newHTTPAccessRecord(r *http.Request, protocol, capsetID string) accesslog.Record {
	return accesslog.Record{
		Protocol:   protocol,
		Capset:     capsetID,
		Route:      r.URL.Path,
		HTTPMethod: r.Method,
		RemoteAddr: r.RemoteAddr,
		UserAgent:  r.UserAgent(),
	}
}

func (g *Gateway) finishHTTPAccessLog(start time.Time, record accesslog.Record, status int) {
	record.HTTPStatus = status
	if record.GRPCCode == "" {
		record.GRPCCode = grpcCodeFromHTTPStatus(status).String()
	}
	record.DurationMS = time.Since(start).Milliseconds()
	g.appendAccessLog(record)
	g.logProtocolFailure(record)
}

func (g *Gateway) newGRPCAccessRecord(ctx context.Context, protocol, route string) accesslog.Record {
	md, _ := metadata.FromIncomingContext(ctx)
	record := accesslog.Record{
		Protocol:   protocol,
		Capset:     firstMD(md, "x-octobus-capset"),
		Instance:   firstMD(md, "x-octobus-instance"),
		Route:      route,
		RemoteAddr: grpcRemoteAddr(ctx),
		UserAgent:  firstMD(md, "user-agent"),
	}
	if protocol == "grpc" {
		record.Method = trimGRPCMethod(route)
	}
	return record
}

func (g *Gateway) finishGRPCAccessLog(start time.Time, record accesslog.Record, err error) {
	record.GRPCCode = status.Code(err).String()
	record.DurationMS = time.Since(start).Milliseconds()
	g.appendAccessLog(record)
	g.logProtocolFailure(record)
}

func (g *Gateway) appendAccessLog(record accesslog.Record) {
	if g == nil || g.AccessLogger == nil {
		return
	}
	if err := g.AccessLogger.Append(record); err != nil {
		g.logger().Error("access_log_write_failed", "error", err)
	}
}

func (g *Gateway) logProtocolFailure(record accesslog.Record) {
	code := parseGRPCCode(record.GRPCCode)
	if record.HTTPStatus >= 200 && record.HTTPStatus < 300 && code == codes.OK {
		return
	}
	if record.HTTPStatus == 0 && code == codes.OK {
		return
	}
	logger := g.logger()
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
		logger.Error("protocol_request_failed", args...)
		return
	}
	logger.Warn("protocol_request_failed", args...)
}

func (g *Gateway) logger() *slog.Logger {
	if g == nil {
		return daemonlog.Nop()
	}
	return daemonlog.OrNop(g.Logger)
}

func parseGRPCCode(value string) codes.Code {
	if value == "" {
		return codes.OK
	}
	for i := codes.OK; i <= codes.Unauthenticated; i++ {
		if i.String() == value {
			return i
		}
	}
	return codes.Unknown
}

func protocolFailureLevel(code codes.Code, httpStatus int) slog.Level {
	switch code {
	case codes.Unauthenticated, codes.PermissionDenied, codes.NotFound, codes.InvalidArgument, codes.Unimplemented, codes.ResourceExhausted, codes.Aborted, codes.FailedPrecondition, codes.OutOfRange, codes.AlreadyExists, codes.Canceled:
		return slog.LevelWarn
	case codes.Unavailable, codes.DeadlineExceeded, codes.Internal, codes.DataLoss, codes.Unknown:
		return slog.LevelError
	}
	if httpStatus >= 500 {
		return slog.LevelError
	}
	return slog.LevelWarn
}

func grpcCodeFromHTTPStatus(httpStatus int) codes.Code {
	switch httpStatus {
	case 0:
		return codes.OK
	case http.StatusOK, http.StatusCreated, http.StatusAccepted, http.StatusNoContent:
		return codes.OK
	case http.StatusBadRequest:
		return codes.InvalidArgument
	case http.StatusUnauthorized:
		return codes.Unauthenticated
	case http.StatusForbidden:
		return codes.PermissionDenied
	case http.StatusNotFound:
		return codes.NotFound
	case http.StatusRequestTimeout:
		return codes.DeadlineExceeded
	case http.StatusConflict:
		return codes.Aborted
	case http.StatusRequestEntityTooLarge, http.StatusTooManyRequests:
		return codes.ResourceExhausted
	case http.StatusNotImplemented:
		return codes.Unimplemented
	case http.StatusServiceUnavailable:
		return codes.Unavailable
	case http.StatusGatewayTimeout:
		return codes.DeadlineExceeded
	default:
		if httpStatus >= 200 && httpStatus < 300 {
			return codes.OK
		}
		if httpStatus >= 500 {
			return codes.Internal
		}
		return codes.Unknown
	}
}

func grpcRemoteAddr(ctx context.Context) string {
	p, ok := peer.FromContext(ctx)
	if !ok || p.Addr == nil {
		return ""
	}
	return p.Addr.String()
}

func trimGRPCMethod(method string) string {
	if method == "" {
		return ""
	}
	if method[0] == '/' {
		return method[1:]
	}
	return method
}
