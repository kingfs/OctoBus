package e2e

import (
	"net/http"
	"regexp"
	"strings"
	"testing"
)

var e2eCommitRE = regexp.MustCompile(`^[0-9a-f]{40}$`)

func TestHTTPSGitCredentialImportRunsAndRedacts(t *testing.T) {
	h := newHarness(t)
	repo := createHTTPSGitFixtureRepo(t, h.root, "user", "p@ss")
	source := strings.Replace(repo.URL, "https://", "https://user:p%40ss@", 1) + "//svc@v1.0.0"

	out := h.mustCLI("service", "import", "echo", "--offline", source)
	if strings.Contains(out, "p@ss") || strings.Contains(out, "p%40ss") || !strings.Contains(out, "******") {
		t.Fatalf("import output did not redact credentials: %s", out)
	}
	row := h.readDB(`SELECT package_source, package_version, descriptor_sha256 FROM services WHERE id = ?`, "echo")
	if strings.Contains(row["package_source"], "p@ss") || strings.Contains(row["package_source"], "p%40ss") || !strings.Contains(row["package_source"], "******") {
		t.Fatalf("stored source not redacted: %+v", row)
	}
	if !e2eCommitRE.MatchString(row["package_version"]) || row["package_version"] != repo.Tags["v1.0.0"] || row["descriptor_sha256"] == "" {
		t.Fatalf("unexpected imported service row: %+v", row)
	}

	configPath := h.root + "/config.json"
	writeJSONFile(t, configPath, map[string]any{"token": "secret-token", "projectKey": "project-a"})
	h.mustCLI("instance", "create", "echo-test", "--service", "echo", "--config", configPath)
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "echo-test")
	cat := h.waitCatalogRunning()
	echo := requireMethod(t, cat, "echo.v1.EchoService/Echo")
	var resp map[string]any
	h.publicConnect(echo.Endpoint, `{"text":"git"}`, http.StatusOK, &resp)
	if resp["text"] != "git" {
		t.Fatalf("git imported service did not run: %+v", resp)
	}
	serviceOut := h.mustCLI("service", "get", "echo")
	if strings.Contains(serviceOut, "p@ss") || strings.Contains(serviceOut, "p%40ss") || !strings.Contains(serviceOut, "******") || !strings.Contains(serviceOut, "PackageVersion") {
		t.Fatalf("service get did not redact or include version: %s", serviceOut)
	}
	daemonLogs := h.stdout.String() + h.stderr.String()
	for _, leaked := range []string{"p@ss", "p%40ss", "https://user:"} {
		if strings.Contains(daemonLogs, leaked) {
			t.Fatalf("daemon diagnostics leaked credentials %q stdout=%s stderr=%s", leaked, h.stdout.String(), h.stderr.String())
		}
	}
	for _, want := range []string{"msg=service_import_started service_id=echo", "msg=service_import_done service_id=echo", "msg=instance_create instance_id=echo-test"} {
		if !strings.Contains(daemonLogs, want) {
			t.Fatalf("daemon diagnostics missing %q stdout=%s stderr=%s", want, h.stdout.String(), h.stderr.String())
		}
	}
}

func TestHTTPSGitReimportLatestRestartsEnabledInstance(t *testing.T) {
	h := newHarness(t)
	repo := createHTTPSGitFixtureRepo(t, h.root, "", "")
	h.mustCLI("service", "import", "echo", "--offline", repo.URL+"//svc@v1.0.0")
	configPath := h.root + "/config.json"
	writeJSONFile(t, configPath, map[string]any{"token": "secret-token", "projectKey": "project-a"})
	h.mustCLI("instance", "create", "echo-test", "--service", "echo", "--config", configPath)
	h.mustCLI("capset", "create", "dev", "--name", "DevAgent")
	h.mustCLI("capset", "add-instance", "dev", "echo-test")
	before := h.readDB(`SELECT pid, listen_addr FROM instances WHERE id = ?`, "echo-test")
	beforeService := h.readDB(`SELECT descriptor_sha256, descriptor_version FROM services WHERE id = ?`, "echo")

	out := h.mustCLI("service", "import", "echo", "--offline", repo.URL+"//svc@latest")
	if !strings.Contains(out, "echo-test") {
		t.Fatalf("git service update should report restarted instance: %s", out)
	}
	after := h.readDB(`SELECT pid, listen_addr FROM instances WHERE id = ?`, "echo-test")
	afterService := h.readDB(`SELECT descriptor_sha256, descriptor_version, package_version FROM services WHERE id = ?`, "echo")
	if afterService["package_version"] != repo.Tags["v1.2.0"] {
		t.Fatalf("latest did not select highest stable tag: %+v", afterService)
	}
	if afterService["descriptor_sha256"] == beforeService["descriptor_sha256"] || afterService["descriptor_version"] == beforeService["descriptor_version"] {
		t.Fatalf("descriptor identity did not change: before=%+v after=%+v", beforeService, afterService)
	}
	if after["pid"] == before["pid"] && after["listen_addr"] == before["listen_addr"] {
		t.Fatalf("enabled instance was not restarted: before=%+v after=%+v", before, after)
	}
	var cat catalog
	h.adminJSON(http.MethodGet, "/admin/v1/catalog/dev", nil, http.StatusOK, &cat)
	if len(cat.GRPC) != 0 || len(cat.ConnectRPC) != 0 || len(cat.MCP) != 0 {
		t.Fatalf("stale method binding remained in catalog: %+v", cat)
	}
	h.mustCLI("capset", "select-method", "dev", "echo-test", "/echo.v1.EchoService/Ping")
	cat = h.waitCatalogRunning()
	ping := requireMethod(t, cat, "echo.v1.EchoService/Ping")
	var pingResp map[string]any
	h.publicConnect(ping.Endpoint, `{"text":"new"}`, http.StatusOK, &pingResp)
	if pingResp["text"] != "new" {
		t.Fatalf("Ping call failed: %+v", pingResp)
	}
}
