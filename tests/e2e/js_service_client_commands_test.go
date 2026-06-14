package e2e

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestJavaScriptServiceExecutableGeneratesClients(t *testing.T) {
	serviceDir := copyCalculatorJSWithLocalSDK(t)

	stub := runNodeServiceCommand(t, serviceDir, "--runtime", "client-stub", "--transport", "connect", "--factory", "createCalculatorClient")
	if !strings.Contains(stub.stdout, "export function createCalculatorClient(options)") ||
		!strings.Contains(stub.stdout, "createConnectRpcStub") ||
		!strings.Contains(stub.stdout, "calculator.v1.CalculatorService/Add") {
		t.Fatalf("unexpected client-stub output:\n%s\nstderr:\n%s", stub.stdout, stub.stderr)
	}

	outDir := filepath.Join(t.TempDir(), "calculator-client")
	pkg := runNodeServiceCommand(t, serviceDir,
		"--runtime",
		"client-package",
		"--transport", "grpc",
		"--name", "@acme/e2e-calculator-client",
		"--out", outDir,
		"--factory", "createCalculatorGrpcClient",
	)
	if !strings.Contains(pkg.stdout, "generated grpc client package at "+outDir) {
		t.Fatalf("unexpected client-package stdout: %s", pkg.stdout)
	}
	if _, err := os.Stat(filepath.Join(outDir, "descriptors", "descriptor.pb")); err != nil {
		t.Fatalf("descriptor-backed client package missing descriptor: %v", err)
	}
	rawPackage, err := os.ReadFile(filepath.Join(outDir, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var packageJSON struct {
		Name         string            `json:"name"`
		Dependencies map[string]string `json:"dependencies"`
	}
	if err := json.Unmarshal(rawPackage, &packageJSON); err != nil {
		t.Fatal(err)
	}
	if packageJSON.Name != "@acme/e2e-calculator-client" ||
		packageJSON.Dependencies["@chaitin-ai/octobus-sdk"] == "" ||
		packageJSON.Dependencies["@grpc/grpc-js"] == "" {
		t.Fatalf("unexpected generated package.json: %s", rawPackage)
	}
	rawIndex, err := os.ReadFile(filepath.Join(outDir, "index.js"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rawIndex), "export function createCalculatorGrpcClient(options)") ||
		!strings.Contains(string(rawIndex), "descriptors") {
		t.Fatalf("unexpected generated index.js: %s", rawIndex)
	}
}

func TestJavaScriptServiceCLIReadsContextEnv(t *testing.T) {
	serviceDir := copyCalculatorJSWithLocalSDK(t)
	if err := os.WriteFile(filepath.Join(serviceDir, ".env"), []byte(`OCTOBUS_SERVICE_CONTEXT='{"config":{"label":"dotenv"},"secret":{"apiToken":"dotenv-secret"}}'`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	dotEnv := runNodeServiceCommand(t, serviceDir, "add", "--data-json", `{"left":8,"right":5}`)
	var dotEnvResponse map[string]any
	if err := json.Unmarshal([]byte(dotEnv.stdout), &dotEnvResponse); err != nil {
		t.Fatalf("decode dotenv response: %v\nstdout:\n%s\nstderr:\n%s", err, dotEnv.stdout, dotEnv.stderr)
	}
	if dotEnvResponse["result"] != float64(13) || dotEnvResponse["label"] != "dotenv" || dotEnvResponse["secretToken"] != "dotenv-secret" {
		t.Fatalf("unexpected dotenv service CLI response: %+v", dotEnvResponse)
	}

	env := runNodeServiceCommandWithEnv(t, serviceDir, []string{
		`OCTOBUS_SERVICE_CONTEXT={"secret":{"apiToken":"env-secret"}}`,
	}, "add", "--data-json", `{"left":8,"right":5}`, "--config-json", `{"label":"cli"}`, "--secret-json", `{"apiToken":"cli-secret"}`)
	var envResponse map[string]any
	if err := json.Unmarshal([]byte(env.stdout), &envResponse); err != nil {
		t.Fatalf("decode env response: %v\nstdout:\n%s\nstderr:\n%s", err, env.stdout, env.stderr)
	}
	if envResponse["result"] != float64(13) || envResponse["label"] != "cli" || envResponse["secretToken"] != "env-secret" {
		t.Fatalf("unexpected env service CLI response: %+v", envResponse)
	}
}

func copyCalculatorJSWithLocalSDK(t *testing.T) string {
	t.Helper()
	source := calculatorPackagePath(t)
	serviceDir := filepath.Join(t.TempDir(), "calculator-js")
	copyDirForTest(t, source, serviceDir)
	copyDirForTest(t, filepath.Join(repoRoot, "sdk"), filepath.Join(serviceDir, "node_modules", "@chaitin-ai", "octobus-sdk"))
	return serviceDir
}

type nodeCommandResult struct {
	stdout string
	stderr string
}

func runNodeServiceCommand(t *testing.T, serviceDir string, args ...string) nodeCommandResult {
	t.Helper()
	return runNodeServiceCommandWithEnv(t, serviceDir, nil, args...)
}

func runNodeServiceCommandWithEnv(t *testing.T, serviceDir string, extraEnv []string, args ...string) nodeCommandResult {
	t.Helper()
	cmd := exec.Command("node", append([]string{filepath.Join("bin", "calculator.js")}, args...)...)
	cmd.Dir = serviceDir
	cmd.Env = append(os.Environ(), "OCTOBUS_PACKAGE_DIR="+serviceDir)
	cmd.Env = append(cmd.Env, extraEnv...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("node calculator.js %s failed: %v\nstdout:\n%s\nstderr:\n%s", strings.Join(args, " "), err, stdout.String(), stderr.String())
	}
	return nodeCommandResult{stdout: stdout.String(), stderr: stderr.String()}
}
