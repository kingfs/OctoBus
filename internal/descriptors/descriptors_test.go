package descriptors

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"octobus/internal/domain"

	"google.golang.org/protobuf/types/descriptorpb"
)

func TestCompile(t *testing.T) {
	dir := t.TempDir()
	protoDir := filepath.Join(dir, "proto")
	if err := os.MkdirAll(protoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(protoDir, "echo.proto"), []byte(`syntax = "proto3";
package echo.v1;
service EchoService {
  rpc Echo(EchoRequest) returns (EchoResponse);
  rpc Watch(EchoRequest) returns (stream EchoResponse);
}
message EchoRequest { string text = 1; }
message EchoResponse { string text = 1; }
`), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := Compile(CompileRequest{PackageDir: dir, ProtoRoots: []string{"proto"}, ProtoFiles: []string{"proto/echo.proto"}, DescriptorPath: filepath.Join(dir, "descriptor.protoset")})
	if err != nil {
		t.Fatal(err)
	}
	if res.DescriptorSHA256 == "" || res.DescriptorVersion == "" {
		t.Fatalf("missing descriptor hashes: %+v", res)
	}
	if len(res.Methods) != 2 {
		t.Fatalf("method count = %d", len(res.Methods))
	}
	if !res.Methods[0].Unary || res.Methods[1].Unary {
		t.Fatalf("unexpected unary metadata: %+v", res.Methods)
	}
}

func TestCompileAndLoadErrors(t *testing.T) {
	if _, err := Compile(CompileRequest{}); err == nil || !strings.Contains(err.Error(), "package dir and descriptor path are required") {
		t.Fatalf("expected missing package/descriptor error, got %v", err)
	}
	dir := t.TempDir()
	if _, err := Compile(CompileRequest{PackageDir: dir, DescriptorPath: filepath.Join(dir, "descriptor.protoset")}); err == nil || !strings.Contains(err.Error(), "proto roots and files are required") {
		t.Fatalf("expected missing proto inputs error, got %v", err)
	}
	if _, err := exec.LookPath("protoc"); err == nil {
		protoDir := filepath.Join(dir, "proto")
		if err := os.MkdirAll(protoDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(protoDir, "bad.proto"), []byte(`syntax = "proto3"; message Broken {`), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := Compile(CompileRequest{PackageDir: dir, ProtoRoots: []string{"proto"}, ProtoFiles: []string{"proto/bad.proto"}, DescriptorPath: filepath.Join(dir, "bad.protoset")}); err == nil || !strings.Contains(err.Error(), "compile proto descriptor") {
			t.Fatalf("expected protoc error, got %v", err)
		}
		if _, err := Compile(CompileRequest{PackageDir: dir, ProtoRoots: []string{"proto"}, ProtoFiles: []string{"proto/missing.proto"}, DescriptorPath: filepath.Join(dir, "missing", "descriptor.protoset")}); err == nil || !strings.Contains(err.Error(), "compile proto descriptor") {
			t.Fatalf("expected missing proto compile error, got %v", err)
		}
	}
	if _, err := Load(filepath.Join(dir, "missing.protoset")); err == nil {
		t.Fatal("expected missing descriptor load error")
	}
	bad := filepath.Join(dir, "bad.protoset")
	if err := os.WriteFile(bad, []byte("not protobuf"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(bad); err == nil {
		t.Fatal("expected invalid descriptor load error")
	}
}

func TestMethodsFromSetAndJSONHelpers(t *testing.T) {
	set := &descriptorpb.FileDescriptorSet{File: []*descriptorpb.FileDescriptorProto{{
		Name:    ptr("echo.proto"),
		Package: ptr("echo.v1"),
		Service: []*descriptorpb.ServiceDescriptorProto{{
			Name: ptr("EchoService"),
			Method: []*descriptorpb.MethodDescriptorProto{{
				Name:       ptr("Echo"),
				InputType:  ptr(".echo.v1.EchoRequest"),
				OutputType: ptr(".echo.v1.EchoResponse"),
			}, {
				Name:            ptr("Upload"),
				InputType:       ptr(".echo.v1.UploadRequest"),
				OutputType:      ptr(".echo.v1.UploadResponse"),
				ClientStreaming: ptr(true),
			}},
		}},
	}}}
	methods := MethodsFromSet(set)
	if len(methods) != 2 {
		t.Fatalf("methods len=%d", len(methods))
	}
	if methods[0].FullName != "echo.v1.EchoService/Echo" || methods[0].InputFullName != "echo.v1.EchoRequest" || !methods[0].Unary {
		t.Fatalf("unexpected unary method: %+v", methods[0])
	}
	if !methods[1].ClientStreaming || methods[1].Unary {
		t.Fatalf("unexpected streaming method: %+v", methods[1])
	}

	raw, err := MarshalMethods(methods)
	if err != nil {
		t.Fatal(err)
	}
	roundTrip, err := UnmarshalMethods(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(roundTrip) != len(methods) || roundTrip[0].FullName != methods[0].FullName {
		t.Fatalf("round trip mismatch: %+v", roundTrip)
	}
	empty, err := UnmarshalMethods("")
	if err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Fatalf("empty methods len=%d", len(empty))
	}
	if _, err := UnmarshalMethods("{"); err == nil {
		t.Fatal("expected invalid JSON error")
	}
	if _, err := MarshalMethods([]domain.Method{{FullName: "svc/Method"}}); err != nil {
		t.Fatal(err)
	}
	if raw, err := MarshalMethods(nil); err != nil || raw != "null" {
		t.Fatalf("nil methods marshal raw=%q err=%v", raw, err)
	}
}

func ptr[T any](v T) *T {
	return &v
}
