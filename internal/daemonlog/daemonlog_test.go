package daemonlog

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func TestNewWritesTextRecords(t *testing.T) {
	var out bytes.Buffer
	logger := New(&out)
	logger.Info("daemon_starting", "addr", "127.0.0.1:9000")
	got := out.String()
	if !strings.Contains(got, "msg=daemon_starting") || !strings.Contains(got, "addr=127.0.0.1:9000") {
		t.Fatalf("unexpected daemon log output:\n%s", got)
	}
}

func TestOrNop(t *testing.T) {
	if got := OrNop(nil); got == nil {
		t.Fatal("nil logger did not fall back to no-op logger")
	}
	logger := slog.New(slog.DiscardHandler)
	if got := OrNop(logger); got != logger {
		t.Fatal("non-nil logger was not preserved")
	}
	Nop().Info("discarded")
}
