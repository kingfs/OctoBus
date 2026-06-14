#!/usr/bin/env bash
set -euo pipefail

out="${1:-bin/octobus}"
mkdir -p "$(dirname "$out")"

version="${OCTOBUS_VERSION:-}"
if [ -z "$version" ]; then
	version="$(
		git describe --tags --match 'v[0-9]*' --exact-match 2>/dev/null ||
			git describe --tags --match 'v[0-9]*' --long --abbrev=7 2>/dev/null ||
			git rev-parse --short HEAD 2>/dev/null ||
			echo dev
	)"
fi

commit="${OCTOBUS_COMMIT:-}"
if [ -z "$commit" ]; then
	commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
fi

date="${OCTOBUS_BUILD_DATE:-}"
if [ -z "$date" ]; then
	date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

ldflags="-s -w"
ldflags="$ldflags -X octobus/internal/version.Version=$version"
ldflags="$ldflags -X octobus/internal/version.Commit=$commit"
ldflags="$ldflags -X octobus/internal/version.Date=$date"

CGO_ENABLED="${CGO_ENABLED:-0}" go build -trimpath -tags "netgo,osusergo" -ldflags="$ldflags" -o "$out" ./cmd/octobus
