#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pack_destination=""
dry_run=true

usage() {
	cat <<'USAGE'
usage: scripts/build-octobus-npm-packages.sh [--dry-run] [--pack-destination DIR]

Build all OctoBus platform npm packages using scripts/build-octobus.sh.
Without --pack-destination, the script builds the binaries and runs npm pack --dry-run.
USAGE
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--dry-run)
			dry_run=true
			shift
			;;
		--pack-destination)
			if [ "$#" -lt 2 ]; then
				echo "--pack-destination requires a directory" >&2
				exit 2
			fi
			pack_destination="$2"
			dry_run=false
			shift 2
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "unknown argument: $1" >&2
			usage >&2
			exit 2
			;;
	esac
done

main_package_dir="$repo_root/npm/octobus"
main_version="$(node -p "require('${main_package_dir}/package.json').version")"
platform_packages=(
	"linux x64 amd64 octobus"
	"linux arm64 arm64 octobus"
	"darwin x64 amd64 octobus"
	"darwin arm64 arm64 octobus"
	"win32 x64 amd64 octobus.exe"
	"win32 arm64 arm64 octobus.exe"
)

check_package_version() {
	local package_dir="$1"
	local package_name
	local package_version
	package_name="$(node -p "require('${package_dir}/package.json').name")"
	package_version="$(node -p "require('${package_dir}/package.json').version")"
	if [ "$package_version" != "$main_version" ]; then
		echo "$package_name version $package_version does not match @chaitin-ai/octobus $main_version" >&2
		exit 1
	fi
}

check_package_version "$main_package_dir"
for entry in "${platform_packages[@]}"; do
	read -r npm_os npm_cpu _goarch _binary_name <<<"$entry"
	check_package_version "$repo_root/npm/octobus-${npm_os}-${npm_cpu}"
	optional_version="$(node -p "require('${main_package_dir}/package.json').optionalDependencies['@chaitin-ai/octobus-${npm_os}-${npm_cpu}']")"
	if [ "$optional_version" != "$main_version" ]; then
		echo "@chaitin-ai/octobus optional dependency @chaitin-ai/octobus-${npm_os}-${npm_cpu} is $optional_version, want $main_version" >&2
		exit 1
	fi
done

export OCTOBUS_BUILD_DATE="${OCTOBUS_BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

for entry in "${platform_packages[@]}"; do
	read -r npm_os npm_cpu goarch binary_name <<<"$entry"
	package_dir="$repo_root/npm/octobus-${npm_os}-${npm_cpu}"
	output="$package_dir/bin/$binary_name"
	rm -rf "$package_dir/bin"
	mkdir -p "$package_dir/bin"

	case "$npm_os" in
		linux) goos="linux" ;;
		darwin) goos="darwin" ;;
		win32) goos="windows" ;;
		*)
			echo "unsupported npm os: $npm_os" >&2
			exit 1
			;;
	esac

	echo "building @chaitin-ai/octobus-${npm_os}-${npm_cpu}"
	GOOS="$goos" GOARCH="$goarch" bash "$repo_root/scripts/build-octobus.sh" "$output"
	if [ "$npm_os" != "win32" ]; then
		chmod 755 "$output"
	fi
done

if [ "$dry_run" = true ]; then
	(cd "$main_package_dir" && npm pack --dry-run)
	for entry in "${platform_packages[@]}"; do
		read -r npm_os npm_cpu _goarch _binary_name <<<"$entry"
		(cd "$repo_root/npm/octobus-${npm_os}-${npm_cpu}" && npm pack --dry-run)
	done
else
	case "$pack_destination" in
		/*) ;;
		*) pack_destination="$repo_root/$pack_destination" ;;
	esac
	mkdir -p "$pack_destination"
	(cd "$main_package_dir" && npm pack --pack-destination "$pack_destination")
	for entry in "${platform_packages[@]}"; do
		read -r npm_os npm_cpu _goarch _binary_name <<<"$entry"
		(cd "$repo_root/npm/octobus-${npm_os}-${npm_cpu}" && npm pack --pack-destination "$pack_destination")
	done
fi
