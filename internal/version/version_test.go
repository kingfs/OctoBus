package version

import "testing"

func TestInfoString(t *testing.T) {
	got := Info{Version: "v1.2.3", Commit: "abc1234", Date: "2026-06-15T01:02:03Z"}.String()
	want := "version: v1.2.3\ncommit: abc1234\ndate: 2026-06-15T01:02:03Z\n"
	if got != want {
		t.Fatalf("Info.String() = %q, want %q", got, want)
	}
}
