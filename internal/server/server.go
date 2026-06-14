package server

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"

	"octobus/internal/protocol"
)

func Handler(admin http.Handler, gateway *protocol.Gateway) http.Handler {
	e := echo.New()
	if admin != nil {
		e.Any("/admin/*", echo.WrapHandler(admin))
	}
	if gateway != nil {
		gatewayHandler := echo.WrapHandler(gateway.Handler())
		e.Any("/capsets/:capset_id/mcp", gatewayHandler)
		e.Any("/capsets/:capset_id/openapi.json", gatewayHandler)
		e.Any("/capsets/:capset_id/openapi.yaml", gatewayHandler)
		e.Any("/capsets/:capset_id/connect/:instance_id/*", gatewayHandler)
	}
	return e
}

func PublicHandler(grpcHandler http.Handler, gateway *protocol.Gateway) http.Handler {
	return CombinedHandler(nil, grpcHandler, gateway)
}

func CombinedHandler(admin http.Handler, grpcHandler http.Handler, gateway *protocol.Gateway) http.Handler {
	httpHandler := Handler(admin, gateway)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isGRPC(r) {
			grpcHandler.ServeHTTP(w, r)
			return
		}
		httpHandler.ServeHTTP(w, r)
	})
}

func isGRPC(r *http.Request) bool {
	return r.ProtoMajor == 2 && strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc")
}
