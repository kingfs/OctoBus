package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"octobus/internal/protocol"
	"octobus/internal/store"
)

func TestHandlerKeepsAdminSeparateFromDataPlane(t *testing.T) {
	admin := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	})
	handler := Handler(admin, nil)

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/v1/status", nil))
	if w.Code != http.StatusAccepted {
		t.Fatalf("admin status = %d", w.Code)
	}

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/capsets/dev/mcp", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("data-plane route on admin-only handler = %d", w.Code)
	}
}

func TestPublicHandlerRoutesGRPCBeforeHTTPPaths(t *testing.T) {
	grpcHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := PublicHandler(grpcHandler, nil)
	req := httptest.NewRequest(http.MethodPost, "/echo.v1.EchoService/Echo", nil)
	req.ProtoMajor = 2
	req.Header.Set("Content-Type", "application/grpc")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("grpc route status = %d", w.Code)
	}
}

func TestCombinedHandlerServesAdminAndDataPlane(t *testing.T) {
	admin := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	})
	st, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	handler := CombinedHandler(admin, http.NotFoundHandler(), &protocol.Gateway{Store: st})

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/v1/status", nil))
	if w.Code != http.StatusAccepted {
		t.Fatalf("admin status = %d", w.Code)
	}

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/capsets/missing/mcp", nil))
	if w.Code == http.StatusNotFound {
		t.Fatalf("MCP route was not handled by gateway")
	}
}

func TestPublicHandlerServesDataPlanePaths(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "octobus.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	handler := PublicHandler(http.NotFoundHandler(), &protocol.Gateway{Store: st})

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/capsets/missing/mcp", nil))
	if w.Code == http.StatusNotFound {
		t.Fatalf("MCP route was not handled by gateway")
	}

	w = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/capsets/missing/connect/inst/pkg.Service/Call", nil)
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("Connect gateway status = %d body=%s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/c/missing/i/inst/pkg.Service/Call", nil)
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("old short Connect route status = %d body=%s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/capsets/missing/services/svc/instances/inst/connect/pkg.Service/Call", nil)
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("old full Connect route status = %d body=%s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/capsets/missing/openapi.json", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("OpenAPI gateway status = %d body=%s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/capsets/missing/services/svc/instances/inst/rest/pkg.Service/Call", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("old REST route status = %d body=%s", w.Code, w.Body.String())
	}
}
