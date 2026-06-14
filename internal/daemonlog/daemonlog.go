package daemonlog

import (
	"io"
	"log/slog"
)

// New creates the daemon's structured text logger.
func New(w io.Writer) *slog.Logger {
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo}))
}

// Nop returns a logger that drops all records.
func Nop() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// OrNop normalizes optional logger injection points.
func OrNop(logger *slog.Logger) *slog.Logger {
	if logger == nil {
		return Nop()
	}
	return logger
}
