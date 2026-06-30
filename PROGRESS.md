# Services SDK 0.6.0 Upgrade Progress

本文档把 `services/` SDK 0.6.0 升级拆成可独立执行、独立验收的任务清单。任务按依赖顺序排列；标记为“可并行”的子任务可以在同一父任务内用 subagent 并行推进，但 subagent 并发度最高不超过 5。

## 文档索引

- 技术方案：[docs/spec/services-sdk-0-6-upgrade-spec.md](docs/spec/services-sdk-0-6-upgrade-spec.md)
- 实施计划：[docs/plan/services-sdk-0-6-upgrade-implementation-plan.md](docs/plan/services-sdk-0-6-upgrade-implementation-plan.md)
- Harness：[AGENTS.md](AGENTS.md)
- Task 工作流：[Taskfile.yml](Taskfile.yml)
- Services 质量线：[docs/design/technical/services-package-quality.md](docs/design/technical/services-package-quality.md)
- SDK 设计：[docs/design/technical/js-sdk.md](docs/design/technical/js-sdk.md)
- 发布和生成物策略：[docs/design/technical/release.md](docs/design/technical/release.md)
- CI：[.github/workflows/ci.yml](.github/workflows/ci.yml)

## 执行规则

- [x] 每个任务完成时必须同时完成对应测试方案和验收标准。
- [x] 不跨阶段提前合并依赖未满足的功能；阶段 2 后项目必须保持 services 可验证。
- [x] 不修改 proto、schema、service name、bin、handler key、runtime mode 或上游业务字段。
- [x] 不提交 `services/package-lock.json`、`node_modules/`、pack artifact、日志、coverage、`.env` 或 secret。
- [x] helper 迁移只做语义等价或已由测试覆盖的变更；遇到错误码、message、details 或 payload shape 差异时停止扩大批次。
- [x] 每个任务合并前至少运行该任务要求的最小测试；阶段性收口时运行 harness 定义的完整门禁。
- [x] 每个任务完成后必须按 `状态`、`变更`、`验证`、`审计与例外`、`下一目标` 更新完成总结。

## 1. 基线确认和变更清单

参考文档：[实施计划 阶段 1](docs/plan/services-sdk-0-6-upgrade-implementation-plan.md#阶段-1基线确认和变更清单)

- [x] 1.1 确认 SDK 0.6.0 和 services 当前依赖面
  - 依赖：无。
  - 工作内容：
    - 确认 npmjs `@chaitin-ai/octobus-sdk@latest` 为 `0.6.0`，且依赖、engine、bin、types 与 spec 一致。
    - 统计 `services/package.json` 和 `services/*/package.json` 中 `@chaitin-ai/octobus-sdk` `^0.5.0` 命中数。
    - 确认 `services/package-lock.json`、`services/node_modules/` 和 pack artifact 不应提交。
    - 记录当前 `git status --short`，避免后续误回滚无关变更。
  - 可并行子任务：
    - [x] 可并行：npm registry 元数据确认。
    - [x] 可并行：services dependency 命中统计。
    - [x] 可并行：生成物和 git 状态审计。
  - 测试方案：
    - `npm view @chaitin-ai/octobus-sdk@latest version dependencies engines main types bin --json`
    - `rg '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"' services/package.json services/*/package.json`
    - `git status --short`
  - 验收标准：
    - 确认目标依赖为 `^0.6.0`，不使用 `latest`。
    - 确认需要更新的 dependency 声明范围和相关文档/fixture 范围。
    - 未发现需要提交的 lockfile 或 node_modules。
  - 完成总结：
    - 状态：已完成。确认 SDK 0.6.0 发布事实、services 当前依赖面和本地生成物边界，未修改业务源码。
    - 变更：
      - 更新本任务 checkbox 和完成证据。
      - 确认目标依赖应固定写为 `^0.6.0`，不使用 `latest`。
      - 确认当前需要升级的 package dependency 声明为 51 处：`services/package.json` 1 处和 50 个 service root `package.json`。
      - 确认 service root dependency 形态为 1 个阿里云 SDK + OctoBus SDK、44 个 OctoBus SDK + `undici`、5 个仅 OctoBus SDK。
    - 验证：
      - `npm view @chaitin-ai/octobus-sdk@latest version dependencies engines main types bin --json`：返回 `version` 为 `0.6.0`，`engines.node` 为 `>=20`，`main` 为 `dist/index.js`，`types` 为 `dist/index.d.ts`，`bin.octobus-sdk` 为 `dist/cli.js`，依赖包含 `undici`。
      - `rg '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"' services/package.json services/*/package.json`：命中 51 处。
      - Node dependency 统计脚本：确认 51 个 package JSON 均声明 `@chaitin-ai/octobus-sdk`，当前版本集合仅为 `^0.5.0`。
      - `git check-ignore -v services/package-lock.json services/node_modules services/example.tgz services/foo.tar.gz services/foo.zip services/foo.log services/coverage 2>/dev/null || true`：确认 `services/package-lock.json`、`services/node_modules`、日志和 coverage 由 ignore 规则覆盖；`.tgz`、`.tar.gz`、`.zip` 不在通用 ignore 中，后续必须通过 pack/污染审计避免提交。
      - `git ls-files services/package-lock.json services/node_modules 'services/*.tgz' 'services/*.tar.gz' 'services/*.zip' 'services/*.log' services/coverage`：无 tracked 输出。
      - `find services -maxdepth 2 \( -name 'package-lock.json' -o -name 'node_modules' -o -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.log' -o -name '.env' -o -name 'coverage' \) -print | sort`：本地存在 `services/node_modules` 和 `services/package-lock.json`，均为 ignored 生成物，不进入提交。
      - `git status --short`：任务开始时仅有已 staged 的 `PROGRESS.md`、`docs/plan/services-sdk-0-6-upgrade-implementation-plan.md`、`docs/spec/services-sdk-0-6-upgrade-spec.md`。
    - 审计与例外：
      - 未修改 `services/` package、proto、schema、service name、bin、handler key、runtime mode、dispatcher mapping 或业务源码。
      - 当前 `services/package-lock.json` 和 `services/node_modules` 在工作区存在但被 ignore；后续任务运行前仍需持续审计并避免纳入提交。
      - `.tgz`、`.tar.gz`、`.zip` pack artifact 当前未发现 tracked 或 untracked 待提交文件，但不依赖 ignore 规则保护，阶段 2/6/7 必须继续检查。
    - 下一目标：任务 2.1。

## 2. 统一 SDK Dependency 版本

参考文档：[实施计划 阶段 2](docs/plan/services-sdk-0-6-upgrade-implementation-plan.md#阶段-2统一-sdk-dependency-版本)

- [x] 2.1 批量更新 services package SDK 版本
  - 依赖：任务 1.1。
  - 工作内容：
    - 将 `services/package.json` 的 `dependencies["@chaitin-ai/octobus-sdk"]` 从 `^0.5.0` 改为 `^0.6.0`。
    - 将所有 `services/*/package.json` 的直接 SDK dependency 从 `^0.5.0` 改为 `^0.6.0`。
    - 保留每个 package 文件的既有依赖顺序、缩进和其他依赖版本。
    - 保留已存在的 `undici` 直接依赖和根 `bundledDependencies`。
  - 可并行子任务：
    - [x] 可并行：root `services/package.json` 更新。
    - [x] 可并行：50 个 service root `package.json` 更新，可按目录分片。
  - 测试方案：
    - `rg '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"' services/package.json services/*/package.json`
    - `node -e 'const fs=require("fs"),path=require("path"); const files=["services/package.json",...fs.readdirSync("services").map(d=>path.join("services",d,"package.json")).filter(fs.existsSync)]; for (const f of files){const p=JSON.parse(fs.readFileSync(f,"utf8")); if(p.dependencies?.["@chaitin-ai/octobus-sdk"]!=="^0.6.0") throw new Error(f);}'`
  - 验收标准：
    - 51 处 package dependency 均为 `^0.6.0`。
    - 未修改 proto、schema、service name、bin、handler key 或业务源码。
    - 没有新增 tracked lockfile 或 node_modules。
  - 完成总结：
    - 状态：已完成。完成纯 dependency 声明升级，未修改业务源码或 runtime 契约文件。
    - 变更：
      - `services/package.json` 中 `dependencies["@chaitin-ai/octobus-sdk"]` 从 `^0.5.0` 更新为 `^0.6.0`。
      - 50 个 `services/*/package.json` 中直接 SDK dependency 从 `^0.5.0` 更新为 `^0.6.0`。
      - 保留根 `bundledDependencies` 为 `@alicloud/swas-open20200601`、`@chaitin-ai/octobus-sdk`、`commander`、`undici`。
      - 未修改 proto、schema、service name、bin、handler key、dispatcher mapping、runtime mode 或业务源码。
    - 验证：
      - `rg -l '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"' services/package.json services/*/package.json | wc -l`：任务开始前确认命中 51 个 package 文件。
      - `rg '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"' services/package.json services/*/package.json || true`：升级后无输出。
      - `node -e 'const fs=require("fs"),path=require("path"); const files=["services/package.json",...fs.readdirSync("services").map(d=>path.join("services",d,"package.json")).filter(fs.existsSync)]; let count=0; for (const f of files){const p=JSON.parse(fs.readFileSync(f,"utf8")); if(p.dependencies?.["@chaitin-ai/octobus-sdk"]!=="^0.6.0") throw new Error(f); count++;} console.log(`checked ${count} package files`);'`：输出 `checked 51 package files`。
      - 根 `services/package.json` 审计脚本：确认 SDK dependency 为 `^0.6.0`，`bundledDependencies` 仍包含原 4 项运行时依赖。
      - `git diff --name-only`：仅 51 个 package JSON 发生变更。
      - `git diff --stat`：51 个文件各 1 行版本号替换，总计 51 insertions、51 deletions。
      - `git ls-files --others --exclude-standard`：无输出。
      - `find services -maxdepth 2 \( -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.log' -o -name '.env' -o -name 'coverage' \) -print | sort`：无输出。
    - 审计与例外：
      - 本任务只覆盖 dependency 声明；`services/tests/validate-service-package.test.mjs`、service README 和设计文档示例仍由任务 2.2 更新。
      - 本地 ignored 的 `services/package-lock.json` 和 `services/node_modules` 未进入 `git status` 或提交范围。
    - 下一目标：任务 2.2。

- [x] 2.2 更新依赖版本相关 fixture 和文档示例
  - 依赖：任务 2.1。
  - 工作内容：
    - 更新 `services/tests/validate-service-package.test.mjs` 中测试 fixture 的 SDK 版本字符串为 `^0.6.0`。
    - 更新 `services/first__epss-v1/README.md` 中 SDK 版本说明为 `^0.6.0`。
    - 更新 `docs/design/technical/multi-service-npm-package.md` 和 `docs/design/technical/service-package.md` 中 services package 示例依赖为 `^0.6.0`。
  - 可并行子任务：
    - [x] 可并行：测试 fixture 更新。
    - [x] 可并行：service README 更新。
    - [x] 可并行：设计文档示例更新。
  - 测试方案：
    - `rg '\\^0\\.5\\.0|0\\.5\\.0' services docs/design/technical/multi-service-npm-package.md docs/design/technical/service-package.md`
  - 验收标准：
    - services 和相关设计文档不再引用 SDK 0.5.0。
    - `examples/*` 未被修改；示例升级不在首版范围内。
  - 完成总结：
    - 状态：已完成。完成 SDK 版本相关 fixture、service README 和设计文档示例同步。
    - 变更：
      - `services/tests/validate-service-package.test.mjs` 中 4 个测试 fixture 的 SDK dependency 改为 `^0.6.0`。
      - `services/first__epss-v1/README.md` 中 SDK 版本说明改为 `^0.6.0`。
      - `docs/design/technical/multi-service-npm-package.md` 中 services package 示例依赖改为 `^0.6.0`。
      - `docs/design/technical/service-package.md` 中 JavaScript service package 依赖基线和 SDK npmjs 分发示例改为 `^0.6.0`。
    - 验证：
      - `rg -n '\\^0\\.5\\.0|0\\.5\\.0' services docs/design/technical/multi-service-npm-package.md docs/design/technical/service-package.md || true`：无输出。
      - `git diff --name-only -- examples`：无输出，确认未修改 `examples/*`。
      - `git diff --name-only`：仅包含两份设计文档、`services/first__epss-v1/README.md` 和 `services/tests/validate-service-package.test.mjs`。
    - 审计与例外：
      - 本任务没有运行 services validate/test/pack check；完整纯依赖升级门禁由任务 2.3 执行。
      - 未修改 package import、proto、schema、service name、bin、handler key、runtime mode 或业务源码。
    - 下一目标：任务 2.3。

- [x] 2.3 跑纯依赖升级 services 门禁
  - 依赖：任务 2.1、任务 2.2。
  - 工作内容：
    - 清理不应提交的 `services/package-lock.json`、`services/node_modules/`、pack artifact 和日志。
    - 运行 services 结构、测试和 pack dry-run 门禁。
    - 如果仅依赖升级导致测试失败，停止后续 helper 迁移并定位 SDK 0.6.0 兼容性问题。
  - 可并行子任务：
    - [x] 可并行：运行 `npm run validate`。
    - [x] 可并行：运行 `npm test`。
    - [x] 可并行：运行 `npm run pack:check`，但必须在清理生成物后执行。
  - 测试方案：
    - `cd services && npm run validate`
    - `cd services && npm test`
    - `cd services && npm run pack:check`
    - `git status --short`
  - 验收标准：
    - 三个 services 门禁均通过。
    - `git status --short` 不出现应忽略生成物。
    - helper 迁移前项目处于可验证状态。
  - 完成总结：
    - 状态：已完成。纯依赖升级后的 services validate、test 和 pack dry-run 门禁均通过。
    - 变更：
      - 清理 ignored 的 `services/node_modules` 和 `services/package-lock.json` 后，使用 `cd services && npm install --package-lock=false` 重新安装依赖。
      - 确认重新安装后的 `services/node_modules/@chaitin-ai/octobus-sdk` 版本为 `0.6.0`，且未生成 `services/package-lock.json`。
      - 未修改 tracked 代码或 package 文件；本任务仅更新进度证据。
    - 验证：
      - `node -e 'const p=require("./services/node_modules/@chaitin-ai/octobus-sdk/package.json"); console.log(p.version)'`：输出 `0.6.0`。
      - `test ! -e services/package-lock.json && echo no-package-lock`：输出 `no-package-lock`。
      - `cd services && npm run validate`：通过，输出 `service package naming checks passed`。
      - `cd services && npm test`：通过，19 个 Node tests 全部 pass。
      - `cd services && npm run pack:check`：通过，`npm pack --dry-run` 生成内容审计完成；未留下实际 tarball。
      - `rg '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"' services || true`：无输出。
      - `find services -maxdepth 2 \( -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.log' -o -name '.env' -o -name 'coverage' -o -name 'package-lock.json' \) -print | sort`：无输出。
      - `git status --short`：无输出。
      - `git ls-files --others --exclude-standard`：无输出。
    - 审计与例外：
      - `npm test` 过程中 validator fixture 测试会打印预期错误信息，用于断言非法 package 场景；最终测试结果为 19 pass、0 fail。
      - `npm run pack:check` 输出 npm 的 `.gitignore` fallback warning 和 dry-run tarball 文件名，但最终 `find` 确认未产生可提交 artifact。
      - 本地 `services/node_modules` 作为 ignored 依赖安装目录存在，用于后续 services 测试；未进入 `git status` 或提交范围。
    - 下一目标：任务 3.1。

## 3. 抽取低风险 Helper 迁移候选

参考文档：[实施计划 阶段 3](docs/plan/services-sdk-0-6-upgrade-implementation-plan.md#阶段-3抽取低风险-helper-迁移候选)

- [x] 3.1 生成 helper 迁移候选清单
  - 依赖：任务 2.3。
  - 工作内容：
    - 扫描本地 `grpcCodeFor`、config/secret merge、timeout/TLS、response 读取、JSON parse、脱敏摘要等重复实现。
    - 将候选分为 A 类、B 类、C 类。
    - 明确首批要迁移的 service root；不在清单内的 service 不修改。
    - 将 `mapHttpStatusToCode`、`readResponseJson` 非法 JSON 语义、`google.protobuf.Value` 手写转换默认归为 C 类，除非测试证明可直接替换。
  - 可并行子任务：
    - [x] 可并行：错误构造和状态码映射扫描。
    - [x] 可并行：context/config/secret merge 扫描。
    - [x] 可并行：timeout/TLS/fetch 扫描。
    - [x] 可并行：response 读取、JSON parse、脱敏摘要扫描。
    - [x] 可并行：候选 service 测试覆盖审计。
  - 测试方案：
    - `rg -n "const grpcCodeFor|function grpcCodeFor|new GrpcError\\(grpcCodeFor" services/*/src/*.js`
    - `rg -n "AbortController|AbortSignal\\.timeout|makeTimeoutSignal|fetchWithTimeout" services/*/src/*.js`
    - `rg -n "new Agent\\(|import\\('undici'\\)|from 'undici'|from \\"undici\\"" services/*/src/*.js`
    - `rg -n "\\.\\.\\.\\(ctx\\??\\.config \\?\\? \\{\\}\\)|\\.\\.\\.\\(ctx\\??\\.secret \\?\\? \\{\\}\\)" services/*/src/*.js`
  - 验收标准：
    - 候选清单可直接驱动任务 4.1 和任务 5.1。
    - 每个待迁移 service 都有 focused service-local test。
    - C 类保留项已明确，不会在首批迁移中误改。
  - 完成总结：
    - 状态：已完成。已生成首批 helper 迁移候选清单；本任务未修改 service 源码。
    - 变更：
      - 扫描并聚合 helper 命中面：

        | 类别 | 命中 service 数 | 处理结论 |
        |---|---:|---|
        | 本地 `grpcCodeFor` / `new GrpcError(grpcCodeFor(...))` | 48 | 可按 service 分批迁移，首批只选轻量且测试覆盖充分的 A 类服务。 |
        | 手写 timeout / `fetchWithTimeout` / `AbortSignal.timeout` | 48 | 默认 B 类；SDK `fetchWithTimeout` 的网络错误 message/cause 语义可能不同，不能批量替换。 |
        | 手写 `undici.Agent` / TLS dispatcher | 44 | 可作为 B 类逐个替换为 `createTlsDispatcher(true)`，必须保留 module-level 缓存和测试断言。 |
        | config/secret merge | 47 | 无纯 config/secret A 类；全部带 `ctx.bindings` 兼容层，必须保留既有优先级。 |
        | response text/JSON/脱敏摘要 | 47 | 默认 B/C 类；只有 body read failure 和非法 JSON 语义一致时才能替换。 |
        | protobuf `toValue` / `google.protobuf.Value` shape | 19 | C 类，首批不迁移。 |
        | HTTP status mapping | 19 | C 类，除非测试证明 SDK 默认映射完全一致。 |

      - 首批 A 类候选，供任务 4.1 使用：

        | service root | 允许迁移 helper | 限制 |
        |---|---|---|
        | `services/dingtalk__group-robot` | 本地 `grpcCodeFor` 替换为 SDK `grpcCodeFor`；保留 `errorWithCode` message 和 `legacyCode`。 | 不迁移 `mergedBindings`，因为测试要求 secret 覆盖 bindings；不迁移 timeout/read helper。 |
        | `services/feishu__group-robot` | 本地 `grpcCodeFor` 替换为 SDK `grpcCodeFor`；保留 `errorWithCode` message 和 `legacyCode`。 | 不迁移 `mergedBindings`；HTTP/TLS 只作为任务 5.1 B 类候选。 |
        | `services/slack__group-robot` | 本地 `grpcCodeFor` 替换为 SDK `grpcCodeFor`；保留 `errorWithCode` message 和 `legacyCode`。 | 不迁移 `mergedBindings`，因为测试要求 secret 覆盖 bindings；不迁移 timeout/read helper。 |

      - 首批 B 类候选，供任务 5.1 小批量评估：

        | service root | 可评估 helper | 必须保留的 service 语义 |
        |---|---|---|
        | `services/feishu__group-robot` | `createTlsDispatcher(true)` 替换本地 module-level `new Agent(...)`；可评估 `normalizeTimeoutMs`。 | 保留当前 fetch error、response read error、HTTP status 和 `httpBody` shape；暂不直接使用 `fetchWithTimeout` 或 `readResponseJson`。 |
        | `services/dingtalk__group-robot` | 可评估 `normalizeTimeoutMs`。 | `skipTlsVerify` 仍必须报 `INVALID_ARGUMENT`；网络错误 message 继续使用 cause message；暂不使用 `fetchWithTimeout`。 |
        | `services/slack__group-robot` | 可评估 `normalizeTimeoutMs`。 | `skipTlsVerify` 仍必须报 `INVALID_ARGUMENT`；网络错误 message 继续使用 cause message；暂不使用 `fetchWithTimeout`。 |

      - C 类保留项：
        - 19 个 protobuf `toValue` / `google.protobuf.Value` shape service：`alibaba-cloud__simple-application-server-firewall`、`chaitin__safeline-waf`、`das__tgfw_v6`、`defectdojo__defectdojo`、`dptech__fw_v4-6-10`、`dptech__umc-ads_v5-3-29`、`fortinet__fw`、`fortinet__waf`、`hillstone__fw_v5-5-r10`、`imperva__waf-gateway_v13-6-90`、`nsfocus__nips_v5-6-r11`、`panabit__tang-r1`、`qianxin__fw-secgate3600`、`qianxin__fw-secgate3600-http-x`、`qiming-tianqing__waf`、`tencent__tsec_v2-5-1`、`threatbook__claudsandbox_v3`、`threatbook__cloudapi_v3`、`threatbook__tdp`。
        - HTTP status mapping service 默认保留本地映射，尤其是把上游 4xx 映射为 `FAILED_PRECONDITION` 或自定义 `PERMISSION_DENIED` 的实现。
        - `readResponseJson` 默认不迁移；当前多个 service 对非法 JSON 使用 `UNKNOWN`、保留 raw/body length 或返回业务 payload，和 SDK `INTERNAL` 语义不同。
        - 登录/session、签名、业务 code、非 JSON 成功响应和 response payload shape 相关逻辑不纳入首批迁移。
    - 验证：
      - `rg -n "const grpcCodeFor|function grpcCodeFor|new GrpcError\\(grpcCodeFor" services/*/src/*.js`：确认 48 个 service 命中本地错误码 helper。
      - `rg -n "AbortController|AbortSignal\\.timeout|makeTimeoutSignal|fetchWithTimeout" services/*/src/*.js`：确认 48 个 service 命中 timeout/fetch 相关 helper。
      - `rg -n "new Agent\\(|import\\('undici'\\)|from 'undici'|from \\"undici\\"" services/*/src/*.js`：确认 44 个 service 命中 TLS dispatcher。
      - `rg -n "\\.\\.\\.\\(ctx\\??\\.config \\?\\? \\{\\}\\)|\\.\\.\\.\\(ctx\\??\\.secret \\?\\? \\{\\}\\)" services/*/src/*.js`：确认 47 个 service 命中 config/secret merge。
      - `rg -n "readResponse|response\\.text\\(|\\.json\\(|JSON\\.parse|redact|safeError|sanitize|mask|body snippet|bodySnippet" services/*/src/*.js`：确认 47 个 service 命中 response/JSON/脱敏相关实现。
      - 聚合脚本：确认 50 个 service root 均存在 service-local `.test.js`，无缺失测试目录。
      - SDK 0.6.0 本地安装包审计：`services/node_modules/@chaitin-ai/octobus-sdk/dist/index.d.ts` 导出 `grpcCodeFor`、`mergeConfigSecret`、`createTlsDispatcher`、`fetchWithTimeout`、`readResponseText`、`readResponseJson`、`httpStatusError` 等 helper。
      - SDK helper 实现审计：确认 `mergeConfigSecret(ctx)` 只返回 config 后 secret；`fetchWithTimeout` 会把 timeout 映射为 `DEADLINE_EXCEEDED`、外部 abort 映射为 `CANCELLED`、网络失败映射为 `UNAVAILABLE`；`readResponseJson` 非法 JSON 映射为 `INTERNAL`；SDK `mapHttpStatusToCode` 将 400 映射为 `INVALID_ARGUMENT`、404 映射为 `NOT_FOUND`。
      - focused test 覆盖审计：`dingtalk__group-robot`、`feishu__group-robot`、`slack__group-robot`、`tencent__qyweixin-group-robot` 均有 service-local test；前三者覆盖 `legacyCode`、`mergedBindings`、网络错误和 response read failure，企业微信覆盖自定义 HTTP status mapping，故不列入 A 类。
    - 审计与例外：
      - 没有发现可直接迁移到 `mergeConfigSecret(ctx)` 的纯 config/secret merge；47 个命中都涉及 `ctx.bindings` 或 binding compatibility，任务 4.1 不做批量 context merge。
      - `tencent__qyweixin-group-robot` 虽是轻量服务，但其 HTTP status mapping、JSON payload error message 和 `upstreamError` shape 均由测试固定，归入 B/C 类，不进入首批 A 类。
      - 本任务只生成候选清单，没有运行 focused service tests；后续任务 4.1/5.1 修改源码时必须逐 service 运行 validate/test/coverage。
    - 下一目标：任务 4.1。

## 4. 迁移通用 Context 和错误构造 Helper

参考文档：[实施计划 阶段 4](docs/plan/services-sdk-0-6-upgrade-implementation-plan.md#阶段-4迁移通用-context-和错误构造-helper)

- [x] 4.1 迁移 A 类 context 和错误 helper
  - 依赖：任务 3.1。
  - 工作内容：
    - 对 A 类 service 使用 SDK `grpcCodeFor` 或 `serviceError` 替换本地状态码表，保留既有 message shape、`legacyCode`、`details`、`response` 或 `httpStatus`。
    - 对 A 类 service 使用 `mergeConfigSecret(ctx)` 替换纯 config/secret merge，并保留 `ctx.bindings` 覆盖顺序。
    - 对 metadata helper 候选使用 `getMetadataValue(ctx, key)`，只替换不改变 key 优先级的代码。
    - 不修改 public handler signature。
  - 可并行子任务：
    - [x] 可并行：按 service root 分片审计 context merge 并记录本批不迁移原因。
    - [x] 可并行：按 service root 分片迁移状态码 helper。
    - [x] 可并行：按 service root 分片补充或调整 focused tests。
  - 测试方案：
    - 对每个修改的 service 运行：
      - `cd services && npm run validate -- --service-dir <service-dir>`
      - `cd services && npm test -- --service-dir <service-dir>`
      - `cd services && npm test -- --coverage --service-dir <service-dir>`
    - 批次完成后运行：
      - `cd services && npm run validate`
      - `cd services && npm test`
  - 验收标准：
    - 被迁移 service 的错误码、message、legacy fields 和测试断言保持不变。
    - `services/scripts/validate-service-package.mjs` 未发现双参数 exported handler。
    - 覆盖率门禁对每个修改 service 通过。
  - 完成总结：
    - 状态：已完成。按 3.1 候选清单迁移首批 A 类错误 helper；未迁移 context merge。
    - 变更：
      - `services/dingtalk__group-robot/src/dingtalk-group-robot.js`：从 SDK 直接导入 `grpcCodeFor`，删除本地 `grpcStatus` 状态表；保留 `errorWithCode` message 和 `legacyCode`。
      - `services/feishu__group-robot/src/feishu-group-robot.js`：从 SDK 直接导入 `grpcCodeFor`，删除本地 `grpcStatus` 状态表；保留 `errorWithCode` message 和 `legacyCode`。
      - `services/slack__group-robot/src/slack-group-robot.js`：从 SDK 直接导入 `grpcCodeFor`，删除本地 `grpcStatus` 状态表；保留 `errorWithCode` message 和 `legacyCode`。
      - 未修改 handler signature、proto、schema、service name、bin、dispatcher mapping、runtime mode、timeout/TLS/response 读取或业务 payload。
    - 验证：
      - `cd services && npm run validate -- --service-dir dingtalk__group-robot`：通过。
      - `cd services && npm test -- --service-dir dingtalk__group-robot`：通过，34 tests pass。
      - `cd services && npm test -- --coverage --service-dir dingtalk__group-robot`：通过，all files line 99.73%、branch 92.02%、funcs 95.56%。
      - `cd services && npm run validate -- --service-dir feishu__group-robot`：通过。
      - `cd services && npm test -- --service-dir feishu__group-robot`：通过，29 tests pass。
      - `cd services && npm test -- --coverage --service-dir feishu__group-robot`：通过，all files line 100.00%、branch 92.81%、funcs 98.53%。
      - `cd services && npm run validate -- --service-dir slack__group-robot`：通过。
      - `cd services && npm test -- --service-dir slack__group-robot`：通过，33 tests pass。
      - `cd services && npm test -- --coverage --service-dir slack__group-robot`：通过，all files line 99.62%、branch 90.97%、funcs 95.83%。
      - `cd services && npm run validate`：通过，输出 `service package naming checks passed`。
      - `cd services && npm test`：通过，19 package-level Node tests pass。
      - `rg -n "const grpcCodeFor|function grpcCodeFor" services/dingtalk__group-robot/src/dingtalk-group-robot.js services/feishu__group-robot/src/feishu-group-robot.js services/slack__group-robot/src/slack-group-robot.js || true`：无输出。
      - `find services -maxdepth 2 \( -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.log' -o -name '.env' -o -name 'coverage' -o -name 'package-lock.json' \) -print | sort`：无输出。
    - 审计与例外：
      - 未迁移 `mergedBindings` / `mergeConfigSecret`：3.1 已确认 47 个 merge 命中都涉及 `ctx.bindings` 兼容层，且本批三个 service 的测试要求 secret 覆盖 bindings；机械替换会改变优先级。
      - 未补新测试：既有 focused tests 已覆盖 `legacyCode`、unknown code fallback、HTTP/network/read failure 和 bindings 优先级；本次仅删除本地状态表并复用 SDK `grpcCodeFor`。
      - `npm test` 和 coverage 输出中的 validator 错误文本来自 package validator fixture 的预期非法场景，最终结果均为 pass。
    - 下一目标：任务 5.1。

## 5. 迁移 HTTP Timeout、TLS 和 Response 读取 Helper

参考文档：[实施计划 阶段 5](docs/plan/services-sdk-0-6-upgrade-implementation-plan.md#阶段-5迁移-http-timeouttls-和-response-读取-helper)

- [x] 5.1 迁移 A/B 类 HTTP 底层 helper
  - 依赖：任务 4.1。
  - 工作内容：
    - 对 A 类或明确可控的 B 类 service 使用 `normalizeTimeoutMs`、模块级缓存的 `createTlsDispatcher(true)` 和 `fetchWithTimeout`。
    - 移除被迁移 service 中不再需要的手写 `AbortController`、timeout signal 和重复 `undici.Agent` 创建逻辑。
    - 仅在 body read failure 语义一致时使用 `readResponseText`。
    - 仅在非法 JSON 应映射为 `INTERNAL` 的 service 中使用 `readResponseJson`；否则保留本地 parse wrapper。
    - 仅当 SDK 默认 HTTP status 映射与 service 测试一致时使用 `httpStatusError`；否则保留本地错误映射，只复用 `safeErrorSummary` 或 `redactSensitive`。
  - 可并行子任务：
    - [x] 可并行：按 service root 分片迁移 timeout/TLS。
    - [x] 可并行：按 service root 分片审计 response read 和脱敏摘要并记录本批不迁移原因。
    - [x] 可并行：按 service root 分片补充 timeout、TLS skip、network failure、body read failure 或 HTTP status focused tests。
  - 测试方案：
    - 对每个修改的 service 运行：
      - `cd services && npm run validate -- --service-dir <service-dir>`
      - `cd services && npm test -- --service-dir <service-dir>`
      - `cd services && npm test -- --coverage --service-dir <service-dir>`
    - 每个批次完成后运行：
      - `cd services && npm test`
      - `cd services && npm run pack:check`
  - 验收标准：
    - 被迁移 service 不再把 `timeoutMs`、`skipTlsVerify`、`tlsInsecureSkipVerify`、`insecureSkipVerify` 作为伪字段传入原生 `fetch`。
    - 被迁移 service 没有重复 `undici.Agent` 创建逻辑，除非存在特殊 dispatcher 行为并在完成总结中说明。
    - 不改变业务错误码映射和 response field shape。
  - 完成总结：
    - 状态：已完成。完成 3.1 首批 B 类 HTTP helper 的小范围迁移；未改变 fetch、response read、HTTP status 或 payload shape。
    - 变更：
      - `services/dingtalk__group-robot/src/dingtalk-group-robot.js`：使用 SDK `normalizeTimeoutMs` 替换本地 timeout 数值归一化逻辑。
      - `services/feishu__group-robot/src/feishu-group-robot.js`：使用 SDK `normalizeTimeoutMs`；使用 SDK `createTlsDispatcher(true)` 替换本地 module-level `new Agent({ connect: { rejectUnauthorized: false } })`，并移除源码中的 `undici` import。
      - `services/slack__group-robot/src/slack-group-robot.js`：使用 SDK `normalizeTimeoutMs` 替换本地 timeout 数值归一化逻辑。
      - 按 3.1 审计结论保留本地 `fetch`、`makeTimeoutSignal`、response `.text()`、HTTP status mapping、network error cause message、body read failure 和 response payload shape。
    - 验证：
      - `rg -n "from 'undici'|new Agent\\(|fetchWithTimeout|normalizeTimeoutMs|createTlsDispatcher" services/dingtalk__group-robot/src/dingtalk-group-robot.js services/feishu__group-robot/src/feishu-group-robot.js services/slack__group-robot/src/slack-group-robot.js`：确认只出现 `normalizeTimeoutMs` 和 feishu 的 `createTlsDispatcher(true)`，没有引入 `fetchWithTimeout`。
      - `cd services && npm run validate -- --service-dir dingtalk__group-robot && npm test -- --service-dir dingtalk__group-robot && npm test -- --coverage --service-dir dingtalk__group-robot`：通过；coverage all files line 99.73%、branch 91.94%、funcs 95.56%。
      - `cd services && npm run validate -- --service-dir feishu__group-robot && npm test -- --service-dir feishu__group-robot && npm test -- --coverage --service-dir feishu__group-robot`：通过；coverage all files line 100.00%、branch 92.72%、funcs 98.53%。
      - `cd services && npm run validate -- --service-dir slack__group-robot && npm test -- --service-dir slack__group-robot && npm test -- --coverage --service-dir slack__group-robot`：通过；coverage all files line 99.62%、branch 90.85%、funcs 95.83%。
      - `cd services && npm run validate`：通过，输出 `service package naming checks passed`。
      - `cd services && npm test`：通过，19 package-level Node tests pass。
      - `cd services && npm run pack:check`：通过，`npm pack --dry-run` 完成。
      - `rg -n "timeoutMs:|skipTlsVerify:|tlsInsecureSkipVerify:|insecureSkipVerify:" services/dingtalk__group-robot/src/dingtalk-group-robot.js services/feishu__group-robot/src/feishu-group-robot.js services/slack__group-robot/src/slack-group-robot.js || true`：仅 dingtalk 内部 config 对象保留 `timeoutMs: resolveTimeoutMs(callCtx)`，不是原生 `fetch` init 伪字段。
      - `rg -n "from 'undici'|new Agent\\(" services/feishu__group-robot/src/feishu-group-robot.js || true`：无输出。
      - `find services -maxdepth 2 \( -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.log' -o -name '.env' -o -name 'coverage' -o -name 'package-lock.json' \) -print | sort`：无输出。
    - 审计与例外：
      - 未使用 SDK `fetchWithTimeout`：当前服务测试固定网络错误使用 cause message，例如 `network timeout`；SDK helper 会重写网络失败 message，直接替换会改变断言。
      - 未使用 SDK `readResponseText` / `readResponseJson`：当前 body read failure、非 JSON 成功响应和 `http_body` shape 由 service tests 固定。
      - 未使用 SDK `httpStatusError` / `mapHttpStatusToCode`：当前 HTTP status 映射和错误 payload shape 仍由 service 特化逻辑维护。
      - `npm run pack:check` 输出 npm 的 `.gitignore` fallback warning 和 dry-run tarball 文件名，但 `find` 确认未留下可提交 artifact。
    - 下一目标：任务 6.1。

## 6. 全量 Services 门禁和 Import 验证

参考文档：[实施计划 阶段 6](docs/plan/services-sdk-0-6-upgrade-implementation-plan.md#阶段-6全量-services-门禁和-import-验证)

- [x] 6.1 运行全量 services 质量门禁
  - 依赖：任务 2.3；如果执行 helper 迁移，还依赖任务 4.1 和任务 5.1。
  - 工作内容：
    - 清理 `services/package-lock.json`、`services/node_modules/`、`*.tgz`、日志、coverage、临时 data dir、`.env`。
    - 运行全量 services validate/test/pack check。
    - 确认 `rg '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"' services` 无结果。
  - 可并行子任务：
    - [x] 可并行：生成物污染清理和审计。
    - [x] 可并行：全量 validate。
    - [x] 可并行：全量 test。
    - [x] 可并行：pack check。
  - 测试方案：
    - `cd services && npm run validate`
    - `cd services && npm test`
    - `cd services && npm run pack:check`
    - `rg '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"' services`
    - `git status --short`
  - 验收标准：
    - services package 命名、结构、测试和 pack dry-run 均通过。
    - 没有新增 service root、proto、schema、bin 或 dispatcher mapping 变化。
    - 没有应忽略生成物出现在待提交变更中。
  - 完成总结：
    - 状态：已完成。全量 services validate、test、pack dry-run 和 SDK 0.5 残留检查均通过。
    - 变更：
      - 本任务未修改 service 源码或 package 文件；仅记录全量 services 门禁证据。
      - 保持 `services/node_modules` 作为 ignored 本地测试依赖，当前安装的 `@chaitin-ai/octobus-sdk` 为 `0.6.0`。
    - 验证：
      - `git status --short`：任务开始前无输出。
      - `find services -maxdepth 2 \( -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.log' -o -name '.env' -o -name 'coverage' -o -name 'package-lock.json' \) -print | sort`：任务开始和结束均无输出。
      - `node -e 'const p=require("./services/node_modules/@chaitin-ai/octobus-sdk/package.json"); console.log(p.version)'`：输出 `0.6.0`。
      - `cd services && npm run validate`：通过，输出 `service package naming checks passed`。
      - `cd services && npm test`：通过，19 package-level Node tests pass。
      - `cd services && npm run pack:check`：通过，`npm pack --dry-run` 完成。
      - `rg '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"' services || true`：无输出。
      - `git ls-files --others --exclude-standard`：无输出。
    - 审计与例外：
      - 未删除 `services/node_modules`，因为全量 services test 和 pack dry-run 需要本地依赖；该目录被 `.gitignore` 覆盖，未进入 `git status` 或提交范围。
      - `npm test` 输出的 validator 错误文本来自非法 fixture 场景，最终结果为 pass。
      - `npm run pack:check` 输出 npm 的 `.gitignore` fallback warning 和 dry-run tarball 文件名，但最终污染审计无 artifact。
    - 下一目标：任务 6.2。

- [x] 6.2 运行 recursive import 验证
  - 依赖：任务 6.1。
  - 工作内容：
    - 构建 `bin/octobus`。
    - 使用 `services/scripts/import-check-all.mjs` 递归导入 services distribution，验证 service ID、ServiceRoot 和 NodeEntry。
  - 可并行子任务：
    - [x] 可并行：`task build` 构建验证。
    - [x] 可并行：import check 失败日志审计。
  - 测试方案：
    - `task build`
    - `cd services && npm run import:check -- --octobus ../bin/octobus`
  - 验收标准：
    - `bin/octobus` 构建成功且静态链接检查通过。
    - recursive import check 对 50 个 service 通过。
  - 完成总结：
    - 状态：已完成。`bin/octobus` 构建和 services recursive import check 均通过。
    - 变更：
      - 本任务未修改 service 源码、package 文件、proto、schema、service name、bin 配置或 dispatcher mapping；仅记录 recursive import 验证证据。
      - `bin/octobus` 作为 ignored 本地构建输出保留在工作区，用于 import check 和后续仓库级门禁。
    - 验证：
      - `task build`：首次在本地默认环境失败，错误为 `GOSUMDB=off` 导致 `golang.org/toolchain@v0.0.1-go1.26.1.linux-amd64` 无法通过 checksum database 校验。
      - `GOSUMDB=sum.golang.org go env GOSUMDB GONOSUMDB GOTOOLCHAIN GOVERSION GOPROXY`：确认重跑环境启用公共 checksum database，`GOTOOLCHAIN=auto`，`GOVERSION=go1.26.1`；本地私有模块例外和代理链仅作为环境配置审计，不在文档中记录具体内部地址。
      - `GOSUMDB=sum.golang.org task build`：通过，生成 `bin/octobus`。
      - `test -x bin/octobus && file bin/octobus`：确认 `bin/octobus` 为可执行的静态链接 Linux ELF。
      - `cd services && npm run import:check -- --octobus ../bin/octobus`：通过，输出 `import checks passed for 50 services`。
      - `git status --short`：验证后无输出。
      - `git ls-files --others --exclude-standard`：验证后无输出。
      - `find services -maxdepth 2 \( -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.log' -o -name '.env' -o -name 'coverage' -o -name 'package-lock.json' \) -print | sort`：无输出。
    - 审计与例外：
      - `GOSUMDB=off` 是本地环境限制，不是本次 services SDK 升级引入的构建失败；后续 Go/Task 门禁如遇相同问题，使用命令级 `GOSUMDB=sum.golang.org` 记录并重跑。
      - `bin/octobus` 为 ignored build output，未进入 `git status` 或提交范围。
      - recursive import check 覆盖 50 个 service root 的 service ID、ServiceRoot 和 NodeEntry 导入路径；未发现 SDK 0.6.0 dependency 或 helper 迁移导致的 import 回归。
    - 下一目标：任务 6.3。

- [x] 6.3 条件运行全量 service coverage
  - 依赖：任务 6.1；若 helper 迁移覆盖大量 service 或更改共享模式，则必须执行。
  - 工作内容：
    - 判断 helper 迁移范围是否达到“覆盖大量 service 或更改共享模式”条件。
    - 条件满足时运行全量 `coverage:all`。
    - 条件不满足时，在完成总结中记录未运行原因和已运行的 focused coverage 证据。
  - 可并行子任务：
    - [x] 可并行：coverage 运行条件判断。
    - [x] 可并行：coverage 失败 service 汇总。
  - 测试方案：
    - 条件满足时：`cd services && npm run coverage:all`
  - 验收标准：
    - 条件满足时，50 个 service coverage 检查全部通过。
    - 条件不满足时，有明确审计说明。
  - 完成总结：
    - 状态：已完成。helper 迁移未覆盖大量 service、未更改共享模式，因此未触发全量 `coverage:all`。
    - 变更：
      - 本任务未修改 service 源码、package 文件或测试脚本；仅记录 coverage 条件判断。
      - 保持已完成的 focused coverage 作为本次 helper 迁移的 coverage 证据。
    - 验证：
      - `node -e 'const p=require("./services/package.json"); console.log(JSON.stringify(p.scripts,null,2))'`：确认 `coverage:all` 脚本存在，命令为 `node scripts/run-coverage-all.mjs`。
      - `git show --name-only --pretty=format: d9f3838 a533e62 | sed '/^$/d' | sort -u`：确认 helper 迁移提交只修改 `PROGRESS.md` 和 3 个 service 源码：`dingtalk__group-robot`、`feishu__group-robot`、`slack__group-robot`。
      - `git show --stat --oneline d9f3838 a533e62`：确认两个 helper 迁移提交均为小范围变更，没有共享 runner、validator、SDK 源码、proto、schema 或跨 service 框架修改。
      - `rg -n "coverage:all|大量 service|共享模式|focused coverage|coverage" docs/plan/services-sdk-0-6-upgrade-implementation-plan.md PROGRESS.md services/package.json`：确认计划要求为条件触发，并要求条件不满足时记录未运行原因和 focused coverage 证据。
      - 已运行 focused coverage：
        - `dingtalk__group-robot`：任务 4.1 通过 line 99.73%、branch 92.02%、funcs 95.56%；任务 5.1 通过 line 99.73%、branch 91.94%、funcs 95.56%。
        - `feishu__group-robot`：任务 4.1 通过 line 100.00%、branch 92.81%、funcs 98.53%；任务 5.1 通过 line 100.00%、branch 92.72%、funcs 98.53%。
        - `slack__group-robot`：任务 4.1 通过 line 99.62%、branch 90.97%、funcs 95.83%；任务 5.1 通过 line 99.62%、branch 90.85%、funcs 95.83%。
    - 审计与例外：
      - 未运行 `cd services && npm run coverage:all`：触发条件是“helper 迁移覆盖大量 service 或更改共享模式”，而本次 helper 迁移只改 3 个 service 本地实现，且每个被修改 service 均已有 focused coverage 通过。
      - coverage 失败 service 汇总为无：本任务未运行全量 coverage，前序 focused coverage 均通过。
      - 全量 services validate/test/pack 和 recursive import 已分别在任务 6.1、6.2 通过，作为阶段收口的非 coverage 门禁。
    - 下一目标：任务 7.1。

## 7. 仓库级回归和文档收束

参考文档：[实施计划 阶段 7](docs/plan/services-sdk-0-6-upgrade-implementation-plan.md#阶段-7仓库级回归和文档收束)

- [x] 7.1 复查文档和最终污染状态
  - 依赖：任务 6.1、任务 6.2；如果执行任务 6.3，也依赖任务 6.3。
  - 工作内容：
    - 复查 spec、plan、`PROGRESS.md`、被更新设计文档和被影响 service README。
    - 确认文档中的命令与实际 `services/package.json` scripts、`Taskfile.yml` 和 CI 一致。
    - 做最终污染检查，确认未提交 forbidden/generated artifacts。
  - 可并行子任务：
    - [x] 可并行：文档链接和命令审计。
    - [x] 可并行：git status 和 untracked 文件审计。
  - 测试方案：
    - `git status --short`
    - `git ls-files --others --exclude-standard`
  - 验收标准：
    - 文档和实际交付状态一致。
    - 没有 `services/package-lock.json`、`node_modules/`、pack artifact、日志、coverage、`.env` 或 secret 进入待提交变更。
  - 完成总结：
    - 状态：已完成。文档、脚本入口、CI 入口和污染状态复查通过。
    - 变更：
      - 脱敏任务 6.2 中本地 Go 环境审计记录，移除具体内部代理/域名值，只保留 `GOSUMDB=sum.golang.org` 重跑策略和 Go toolchain 事实。
      - 本任务未修改 service 源码、package 文件、proto、schema、service name、bin 配置或测试脚本。
    - 验证：
      - `node -e 'const p=require("./services/package.json"); console.log(Object.entries(p.scripts).map(([k,v])=>`${k}=${v}`).join("\\n"))'`：确认 services scripts 为 `validate`、`test`、`coverage:all`、`import:check`、`pack:check`，与 spec/plan/PROGRESS 使用的命令一致。
      - `sed -n '1,220p' Taskfile.yml`：确认仓库级 harness 入口仍为 `task lint`、`task test`、`task build`；`task build` 继续检查 `bin/octobus` 静态链接。
      - `sed -n '1,260p' .github/workflows/ci.yml`：确认 CI validate job 覆盖 public trace scan、Go format/vet/test、build、OctoBus npm dry-run、SDK npm test/build/pack。
      - `rg -n '"@chaitin-ai/octobus-sdk": "\\^0\\.5\\.0"|"@chaitin-ai/octobus-sdk": "0\\.5\\.0"' services docs/design/technical/multi-service-npm-package.md docs/design/technical/service-package.md`：无输出，当前 services 包和设计文档示例无 SDK 0.5 dependency 残留。
      - 内部痕迹扫描：按 CI public trace scan 的模式集合扩展到 `docs` 和 `PROGRESS.md` 后复查；脱敏前仅命中 `PROGRESS.md` 6.2 的本地 Go 环境记录，本任务已移除具体内部值。
      - `git status --short`：审计开始前无输出。
      - `git ls-files --others --exclude-standard`：无输出。
      - `find services -maxdepth 2 \( -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.log' -o -name '.env' -o -name 'coverage' -o -name 'package-lock.json' \) -print | sort`：无输出。
    - 审计与例外：
      - spec、plan 和 `PROGRESS.md` 中仍保留 `^0.5.0` 历史基线、任务输入或已完成验证描述；这些不是当前 package dependency 或设计示例。
      - `.github/workflows/ci.yml` 的 public trace scan 不覆盖根 `PROGRESS.md`，但本任务仍主动移除了其中的内部代理/域名值，避免过程文档携带私有环境痕迹。
      - 本地 `services/node_modules` 和 `bin/octobus` 仍作为 ignored 测试/构建输出保留，未进入待提交或 untracked 列表。
    - 下一目标：任务 7.2。

- [x] 7.2 运行仓库级 harness 门禁
  - 依赖：任务 7.1。
  - 工作内容：
    - 运行仓库级 lint/test/build。
    - 如果改动影响 package import、routing protocol、supervision、CLI 或 daemon startup，追加运行 e2e。
    - 如果 Go/e2e 失败且与本变更无关，记录证据，不混入无关修复；如果相关，修复后重跑。
  - 可并行子任务：
    - [x] 可并行：`task lint`。
    - [x] 可并行：`task test`。
    - [x] 可并行：`task build`。
    - [x] 可并行：条件 e2e。
  - 测试方案：
    - `task lint`
    - `task test`
    - `task build`
    - 条件触发时：`go test ./tests/e2e -count=1`
  - 验收标准：
    - 仓库级 lint/test/build 通过。
    - 条件触发时 e2e 通过，或完成总结中有明确未运行原因。
    - PR 摘要可列出 SDK dependency 升级、helper 迁移服务列表和实际运行门禁。
  - 完成总结：
    - 状态：已完成。仓库级 lint、test、build 和条件 e2e 均通过。
    - 变更：
      - 本任务未修改 Go、service 源码、SDK 源码、proto、schema、package 文件或测试脚本；仅记录最终仓库级门禁证据。
      - 勾选全局执行规则，表示本次 `PROGRESS.md` 范围内任务均已按依赖、边界、测试和总结规则收口。
    - 验证：
      - `GOSUMDB=sum.golang.org task lint`：通过，包含 gofmt 待格式化检查和 `go vet ./...`。
      - `GOSUMDB=sum.golang.org task test`：通过，包含 SDK build、example dependency smoke、Go unit/integration/e2e coverage、minimum 和 on-demand minimum 示例 smoke。
      - `task test` coverage 输出：unit 87.4%、integration 62.1%、e2e 62.0%、total 89.4%。
      - `GOSUMDB=sum.golang.org task build`：通过，生成 `bin/octobus` 并通过静态链接检查。
      - `GOSUMDB=sum.golang.org go test ./tests/e2e -count=1`：通过，输出 `ok octobus/tests/e2e 64.244s`。
      - `test -x bin/octobus && file bin/octobus`：确认 `bin/octobus` 为可执行的静态链接 Linux ELF。
      - `git status --short`：仓库级门禁后无 tracked 变更。
      - `git ls-files --others --exclude-standard`：无输出。
      - `find services -maxdepth 2 \( -name '*.tgz' -o -name '*.tar.gz' -o -name '*.zip' -o -name '*.log' -o -name '.env' -o -name 'coverage' -o -name 'package-lock.json' \) -print | sort`：无输出。
    - 审计与例外：
      - 使用命令级 `GOSUMDB=sum.golang.org` 是本地 Go 工具链校验例外；默认环境 `GOSUMDB=off` 会阻止下载/校验 `go1.26.1` toolchain。代码和仓库配置未因该环境例外修改。
      - `task test` 脚本本身未强制 AGENTS 中“overall coverage 至少 90%”的文字目标；本次实际输出 total coverage 为 89.4%，低于该文字目标但命令退出码为 0。该差异是现有 harness 口径问题，未在 services SDK 升级中混入无关 Go 覆盖率补测。
      - `task test` 生成的 root `coverage/` 和 `.octobus/` 本地数据目录已清理；`bin/octobus`、SDK/example dependency build output 和 `services/node_modules` 均为 ignored 本地验证产物，未进入提交范围。
      - 条件 e2e 已触发并通过，因为本次变更影响 service package/import 验证路径和 services SDK runtime dependency。
    - 下一目标：无。

## 首版不做的事项

- 不升级 `examples/*` 的 SDK dependency。
- 不发布或改名 `@chaitin-ai/octobus-tentacles`。
- 不修改 SDK 源码、SDK 发布流程或 SDK version。
- 不迁移 services validator/dispatcher 到 SDK multi-service CLI。
- 不删除 service root 的 `undici` 直接依赖，除非对应 service 源码已完成迁移并通过 focused 门禁。
- 不批量替换会改变语义的 HTTP status 映射、非法 JSON 映射或 protobuf `google.protobuf.Value` 手写转换。
- 不改变 proto、schema、service name、bin、handler key、runtime mode 或上游业务字段。
