# OctoBus SDK Roadmap

## 背景

OctoBus SDK 的目标用户是 service package 开发者。它应该让开发者更容易完成以下工作：

- 设计和维护 service package 契约。
- 实现 gRPC handler。
- 本地验证、调试和测试 package。
- 生成可给业务方使用的 client。
- 在导入 OctoBus 前发现 package 结构、运行时和发布内容问题。

当前 `@chaitin-ai/octobus-sdk` 已经覆盖 service package 的基础运行闭环。下一阶段不再规划重复的 runtime、descriptor、client stub 基础能力，而是补齐真实 `services/*` 开发中仍在重复维护的测试、类型、适配器、打包和多 service distribution 工具链。

## 当前已实现能力

### Runtime 与本地开发

- `defineService`：定义 handler map，handler key 使用 `<proto package>.<Service>/<Method>`。
- `runServiceMain` / `runService`：实现 service entry 的命令分发。
- Runtime 命令：
  - `--runtime serve`：启动 long-running gRPC server。
  - `--runtime invoke`：执行 on-demand unary 调用，stdin/stdout 使用 protobuf wire format。
  - `--runtime dev`：启动本地开发 gRPC server。
  - `--runtime inspect`：输出 service manifest 或 config/secret schema。
  - `--runtime client-stub` / `client-package`：从 service entry 生成 client。
- 未带 `--runtime` 时，本地业务 CLI 暴露已实现的一元 method，支持 `--data-json`、`--data`、config、secret、metadata，并输出 ProtoJSON。
- gRPC server 支持 unary、server streaming、client streaming、bidirectional streaming 和 health check。

### Descriptor、验证与生成

- `octobus-sdk bootstrap`：生成最小 Echo service package，支持 `--runtime-mode on-demand|long-running`、`--bundle-deps` 和 `--force`。
- `octobus-sdk validate [--strict]`：校验 `service.json`、`package.json bin`、proto 编译、config/secret schema 文件存在性、handler key、缺失 handler 以及本地业务 CLI metadata。
- `octobus-sdk inspect`：输出 manifest 或 schema，支持 JSON/YAML。
- Descriptor 加载：
  - 从 `service.json` 的 `proto.roots` / `proto.files` 调用 `protoc` 生成 descriptor。
  - 支持 `OCTOBUS_DESCRIPTOR_PATH` 直接加载导入时归档的 descriptor。
  - 使用 `@bufbuild/protobuf` 建立 `FileRegistry`。
- Client 生成：
  - `octobus-sdk client-stub --transport connect|grpc`。
  - `octobus-sdk client-package --transport connect|grpc`。
  - descriptor-backed npm client package，包含 `descriptors/descriptor.pb` 和 `descriptors/service.json`。
  - `client-package` 支持 `--bundle-deps`、`--publish`、`--force` 和 `--factory`。
  - 生成的 `index.d.ts` 已有 service/method wrapper 签名，但 request/response 仍主要是 `unknown`。

### 公开 API

- 错误辅助：
  - `GrpcError`
  - `grpcError`
  - `grpcInvalidArgumentError`
  - `grpcNotFoundError`
  - `grpcPermissionDeniedError`
  - `grpcUnauthenticatedError`
  - `grpcUnavailableError`
  - `grpcStatus`
- Client runtime：
  - `createConnectRpcStub`
  - `createGrpcStub`
  - `generateClientStubSource`
  - `generateClientPackageFiles`
  - `writeClientPackage`
- Package/runtime 辅助：
  - `generateBootstrapPackageFiles`
  - `writeBootstrapPackage`
  - `loadServiceDescriptor`
  - `loadServicePackage`
  - `loadServiceRuntime`
  - `validateService`
  - `assertValidService`
  - `formatValidationIssues`

## 现存差距

### 开发闭环仍不完整

`bootstrap` 当前生成的是最小单文件 package：

- `bin/*.js`
- `proto/*.proto`
- `service.json`
- `config.schema.json`
- `secret.schema.json`
- `README.md`

真实 service package 通常会拆分为 `src/service.js`、`src/<adapter>.js`、`test/*.test.js`，并包含 mock fetch、错误断言和 config/secret 测试。SDK 目前没有测试骨架，也没有公开 handler test harness。

### 类型体验不足

当前 handler request/response 和 generated client request/response 仍多为 `unknown`。开发者仍需要依赖运行时测试发现字段名、wrapper type、int64、Struct/Value 等问题。

### 真实适配器重复代码多

真实 `services/*/src/*.js` 中仍重复实现：

- context/config/secret/bindings 合并。
- baseUrl、headers、timeout、fetch 注入。
- 非 2xx 响应和上游错误到 gRPC error 的映射。
- JSON parse 和响应结构校验。
- protobuf well-known type 与普通 JSON 的转换。

这些属于 service package 开发公共层，适合抽到 SDK 的可复用 helper。

### 发布前检查不足

`octobus-sdk validate` 已经覆盖 manifest、proto、handler key、schema 文件存在性和 CLI metadata，但还不能完整回答“这个 package 导入 OctoBus 前是否一定可用”：

- `npm pack --dry-run` 是否包含所有需要文件。
- runtime dependencies 是否在 `dependencies` 而不是 `devDependencies`。
- package artifact 是否包含 proto、schema、bin target 和 runtime 源码。
- `file:` dependency 是否指向 package 内可打包路径。
- config/secret schema 文件内容是否符合 JSON Schema。

### 多 service distribution 仍未 SDK 化

OctoBus import 侧支持一个 npm distribution package 承载多个 service root。但多 service distribution 的验证和 dispatcher 当前仍在 `services/` 内自维护：

- `services/scripts/validate-service-package.mjs`
- `services/bin/octobus-tentacles.js`
- 每个 service root wrapper bin

这些能力应逐步迁入 SDK。

## 剩余规划

### P0：开发闭环补强

新增 `octobus-sdk check`：

- 复用现有 `validate` 能力。
- 执行 proto 编译、schema 文件存在性、bin 文件、package runtime dependency 检查。
- `--strict` 时缺失 handler 作为错误。
- 输出可读的问题列表，错误信息带文件路径和建议动作。

新增 SDK 测试辅助 API：

- `createTestContext(options)`：构造标准 handler context。
- `invokeHandler(service, method, request, options)`：直接调用 handler。
- `assertGrpcError(error, code, message?)`：断言 SDK gRPC error。

改进 `bootstrap`：

- 保留当前 `minimal` 模板。
- 新增更接近真实 service 的模板，默认包含 `src/service.js`、`src/handlers.js` 和 `test/handlers.test.js`。
- `package.json` 默认包含 `validate`、`test`、`check` scripts。
- README 示例统一使用 `node bin/service.js --runtime dev ...`。

### P1：类型与契约体验

新增 `octobus-sdk types --out <dir>`：

- 从 descriptor 生成 TypeScript declaration。
- 生成 method name union。
- 生成每个 message 的 plain object 类型。
- 生成 `ServiceHandlers` 类型。

新增 typed service API：

- `defineTypedService<ServiceMap>({ handlers })`。
- 在 TypeScript 项目中约束 handler key、request、response。
- JavaScript 项目继续使用 `defineService`，保持兼容。

改进 generated client package：

- `index.d.ts` 不再只使用 `unknown`。
- unary method 输出 `Promise<ResponseType>`。
- streaming method 输出 typed iterable。
- 提供 `--types unknown|descriptor`，默认 `descriptor`。

### P1：真实适配器公共工具

新增 HTTP helper：

- `createHttpClient(options)`。
- 支持 `baseUrl`、默认 headers、timeout、fetch 注入。
- 自动处理 JSON request/response。
- 非 2xx 响应抛出可映射错误。

新增错误映射 helper：

- `grpcErrorFromHttpResponse(response, body)`.
- `upstreamUnavailable(message)`.
- `upstreamInvalidArgument(message)`.

新增 context/config helper：

- `mergeConfigSecret(ctx)`.
- `requireConfigString(ctx, name)`.
- `requireSecretString(ctx, name)`.
- `getOptionalBoolean(ctx, name, defaultValue)`.

新增 protobuf JSON 辅助：

- `toStructValue(value)`.
- `fromWrapperValue(value)`.
- `toInt64String(value)`.
- `normalizeRepeatedValue(value)`.

这些 helper 应放在 SDK 公开 API 中，但避免把重依赖加入核心 runtime。

### P2：多 service distribution 支持产品化

新增 `octobus-sdk multi validate`：

- 校验 root `package.json`。
- 校验 root `bin` 是否包含每个 service root 的 `service.json.name`。
- 校验 wrapper bin 是否指向正确 service root entry。
- 校验 dispatcher 是否包含所有 service。
- 校验 `files` 是否包含 service root、bin、scripts。

新增 `octobus-sdk multi dispatcher`：

- 扫描 distribution package 下所有 service root。
- 生成 root dispatcher。
- 支持 `octobus-tentacles <service> [args]` 风格。
- 生成每个 root wrapper bin。

改进 package root/bin 推断：

- 支持 `distributionRoot`、`serviceRoot`、`serviceName` 三元输入。
- SDK 行为与 Go import 侧多 service package 契约保持一致。

### P2：生成与发布体验

新增 `octobus-sdk pack-check`：

- 执行 `npm pack --dry-run --json`。
- 检查 artifact 是否包含：
  - `package.json`
  - `service.json`
  - proto files
  - config/secret schema
  - bin target
  - runtime 需要的 dist/src 文件
- 检查 `dependencies` 是否包含 SDK。
- 对 `file:` dependency 给出 package 内路径检查。

改进 `client-package`：

- 支持 `--version`。
- 支持 `--license`。
- 支持 `--repository`。
- 支持 `--dry-run-publish`。
- 默认仍只写 package，不自动 publish；现有 `--publish` 继续保持显式触发。

新增 bootstrap templates：

- `minimal`：当前最小 Echo service。
- `http-adapter`：带 baseUrl、headers、timeout、mock fetch test。
- `webhook`：适合群机器人/通知类 service。
- `streaming`：演示 long-running streaming。

默认模板建议使用 `http-adapter`，更贴近当前 service package 的真实需求。

## 公共接口变化

新增 CLI：

```text
octobus-sdk check [--strict]
octobus-sdk pack-check
octobus-sdk types --out <dir>
octobus-sdk multi validate
octobus-sdk multi dispatcher --out <file>
```

新增公开 API：

```ts
createTestContext(options)
invokeHandler(service, method, request, options)
assertGrpcError(error, code, message?)
createHttpClient(options)
grpcErrorFromHttpResponse(response, body)
mergeConfigSecret(ctx)
requireConfigString(ctx, name)
requireSecretString(ctx, name)
defineTypedService<ServiceMap>(definition)
```

兼容策略：

- 保留现有 `defineService`、`runServiceMain`、`runService`。
- 保留现有 Connect/gRPC stub 行为。
- 保留现有 `client-package --publish` 和 `--bundle-deps` 行为。
- 新类型生成和新 helper 都是增量能力。
- JavaScript service package 不需要迁移即可继续运行。

## 验收标准

P0 完成标准：

- `octobus-sdk bootstrap --template http-adapter` 生成的 package 可直接 `npm test`、`npm run validate`、`npm run check`。
- 新 test helper 覆盖 unary handler 的成功、config/secret、metadata、GrpcError 断言。
- 现有 calculator 示例迁移到新 bootstrap 风格后 e2e 通过。

P1 完成标准：

- `octobus-sdk types` 对 calculator fixture 生成可用 `.d.ts`。
- generated client package 的 method 不再暴露为 `unknown`。
- 至少一个真实 service 使用 typed handler 或 typed client 编译通过。
- HTTP helper 能替代至少两个真实 service 中重复的 baseUrl/headers/JSON/error 逻辑。

P2 完成标准：

- `services/scripts/validate-service-package.mjs` 的核心能力可由 `octobus-sdk multi validate` 替代。
- `services/bin/octobus-tentacles.js` 可由 `octobus-sdk multi dispatcher` 生成。
- `octobus-sdk pack-check` 能发现缺失 schema、缺失 bin、缺失 packed proto、SDK 只在 devDependencies 中等错误。
- 多 service package 的 import e2e 继续通过。

## 非目标

下一阶段不优先做：

- 浏览器版 SDK。
- 非 JavaScript/TypeScript SDK。
- 自动从 OpenAPI 完整生成 service package。
- 改变 OctoBus Node startup protocol。
- 改变 service package 以 protobuf descriptor 为事实来源的设计。

## 默认约束

- on-demand、Connect RPC、本地业务 CLI 仍只支持 unary method。
- streaming 继续只作为 long-running gRPC 能力。
- SDK 核心包保持轻量，重依赖通过可选模板或可选子模块引入。
- 所有新增检查都应输出明确、可修复的错误信息。
