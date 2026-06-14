#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export OCTOBUS_ADDR="${OCTOBUS_SMOKE_ADDR:-127.0.0.1:19101}"
export OCTOBUS_DATA_DIR="${OCTOBUS_SMOKE_DATA_DIR:-$(mktemp -d /tmp/octobus-clean-checkout-smoke.XXXXXX)}"

SERVICE_ID="calculator"
INSTANCE_ID="calculator-smoke"
CAPSET_ID="clean-checkout-smoke"
PID=""

cleanup() {
  if [[ -n "${PID}" ]]; then
    kill "${PID}" 2>/dev/null || true
    wait "${PID}" 2>/dev/null || true
  fi
  rm -rf "${OCTOBUS_DATA_DIR}"
}
trap cleanup EXIT INT TERM

task clean
task build
task example:calculator:dev-deps

./bin/octobus serve &
PID=$!

for _ in {1..50}; do
  if ./bin/octobus status >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${PID}" 2>/dev/null; then
    echo "octobus daemon exited before becoming ready" >&2
    exit 1
  fi
  sleep 0.2
done

./bin/octobus status >/dev/null
./bin/octobus service import "${SERVICE_ID}" ./examples/calculator-js >/dev/null
./bin/octobus instance create \
  "${INSTANCE_ID}" \
  --service "${SERVICE_ID}" \
  --config-json '{"label":"clean-checkout-smoke"}' \
  --secret-json '{"apiToken":"runtime-secret"}' >/dev/null
./bin/octobus capset create "${CAPSET_ID}" --name clean-checkout-smoke >/dev/null
./bin/octobus capset add-instance "${CAPSET_ID}" "${INSTANCE_ID}" >/dev/null

response="$(curl -fsS -X POST "http://${OCTOBUS_ADDR}/capsets/${CAPSET_ID}/connect/${INSTANCE_ID}/calculator.v1.CalculatorService/Add" \
  -H 'Content-Type: application/json' \
  -H 'x-octobus-ext-business-request-id: clean-checkout-smoke' \
  -d '{"left":20,"right":22}')"
if [[ "${response}" != *'"result":42'* && "${response}" != *'"result": 42'* ]]; then
  echo "clean checkout smoke call failed: ${response}" >&2
  exit 1
fi

echo "clean checkout smoke ok: ${response}"
