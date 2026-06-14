#!/bin/bash

set -euo pipefail

# 这是一个针对 calculator-js 的最小可跑通脚本。执行之后，把输出的
# markdown 内容 (`========` 分隔符之间的部分) 丢给一个 agent，让它按照描述去调用
# 暴露的接口，就可以看到运行效果。调用期间脚本不能退出。

export OCTOBUS_DATA_DIR="/tmp/.octobus"
export OCTOBUS_ADDR="127.0.0.1:19001"

SERVICE_DIR="examples/calculator-js"
SERVICE_ID="calculator"
INSTANCE_ID="calc01"
CAPSET_ID="dev01"
HOLD_SECONDS="${OCTOBUS_MINIMUM_HOLD_SECONDS:-600}"

# build octobus binary
task build

# build local SDK and install example service package dependencies
task example:calculator:dev-deps

# start daemon, listen on OCTOBUS_ADDR
./bin/octobus serve & # put into background
PID=$!
# auto kill when script ends, we also clear data so it can run again
cleanup() {
  kill "${PID}" 2>/dev/null || true
  wait "${PID}" 2>/dev/null || true
  rm -rf "${OCTOBUS_DATA_DIR}"
}
trap cleanup EXIT INT TERM

# let the server start
sleep 2
set -x

# 1. import the service
./bin/octobus service import "${SERVICE_ID}" "${SERVICE_DIR}"
sleep 2

# 2. create an instance
./bin/octobus instance create \
  "${INSTANCE_ID}" \
  --service "${SERVICE_ID}" \
  --config-json '{"label":"primary"}' \
  --secret-json '{"apiToken":"runtime-secret"}'
sleep 2

# 3.1 create a capset
./bin/octobus capset create "${CAPSET_ID}" --name default-agent
sleep 2
# 3.2 add all methods into it
./bin/octobus capset add-instance \
  "${CAPSET_ID}" \
  "${INSTANCE_ID}"
sleep 2
set +x

# now we can see the methods from catalog
echo
echo "====================================== copy from here =========================================="
echo "BASE_URL is at: ${OCTOBUS_ADDR}, call the following services to test the connectivity"
echo "================================================================================================"
./bin/octobus catalog "${CAPSET_ID}" --all --md
echo "====================================== copy ends here =========================================="
echo

RESPONSE="$(curl -fsS -X POST "http://${OCTOBUS_ADDR}/capsets/${CAPSET_ID}/connect/${INSTANCE_ID}/calculator.v1.CalculatorService/Add" \
  -H 'Content-Type: application/json' \
  -H 'x-octobus-ext-business-request-id: minimum-smoke' \
  -d '{"left":20,"right":22}')"
if [[ "${RESPONSE}" != *'"result":42'* && "${RESPONSE}" != *'"result": 42'* ]]; then
  echo "minimum smoke call failed: ${RESPONSE}" >&2
  exit 1
fi
echo "minimum smoke call ok: ${RESPONSE}"

echo "PASTE the markdown to an agent, and it will show you how to CALL these methods"
sleep "${HOLD_SECONDS}"
