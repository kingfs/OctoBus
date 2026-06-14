# Domain Model

## 核心层级

确认采用：

```text
capset -> service -> instance -> method
```

## capset

`capset` 是暴露给某个 agent 使用的一组确定实例能力。

一个 capset 可以包含多个 service 的多个 instance。一个 service 的不同 instance 可以同时被不同 capset 使用。

示例：公司里存在多套 GitLab 实例，分别是：

- `gitlab-prod`
- `gitlab-test`
- `gitlab-sec`

可以创建不同 capset：

- `capset-dev-agent`: 暴露 `gitlab-test`。
- `capset-release-agent`: 暴露 `gitlab-prod`。
- `capset-security-agent`: 暴露 `gitlab-prod` 和 `gitlab-sec` 的部分 method。

## service

`service` 是稳定逻辑标识，不代表具体运行实例。service 只维护当前版本，不维护多 revision。

service 当前版本包含：

- proto bundle artifact
- descriptor artifact
- descriptor hash / version
- service methods metadata
- method request / response type
- method streaming 信息

再次导入同一个 service id 会更新 service 当前版本。更新成功后，Octobus 立即重启该 service 的所有 enabled instances，使控制面 descriptor、Connect RPC/MCP 转换、reflection 和实际 Node 进程保持一致。

service 更新不维护历史版本。需要回滚时，用户重新导入旧 package artifact。

long-running service 的 gRPC 路径支持 unary 和 streaming methods；Connect RPC、MCP、OpenAPI、on-demand 调用和 SDK 业务 CLI 只支持 unary methods。

删除 service 时，如果仍存在 instance 引用该 service，默认拒绝。用户应先删除相关 instance。无 instance 引用时可以删除 service 记录，但默认保留 artifact/runtime 目录，物理清理由单独 prune/purge 能力负责。

## instance

`instance` 是 service 的具体运行副本，对应一个 Node.js 子进程和一个本地 gRPC endpoint。

一个 service 可以有多个 instance。路由必须显式选中 instance，不做负载均衡。

instance 拥有独立 config、workdir、日志、进程状态和本地 gRPC endpoint。删除 instance 时会停止对应子进程，并级联删除引用该 instance 的 capset bindings，但默认保留 workdir、config 和日志。

instance config 和 secret 完全透传给 service package。若 service package 声明 `configSchema` / `secretSchema`，Octobus 必须按 JSON Schema Draft 2020-12 在 create/update-config 或 create/update-secret 时校验对应 JSON。

## method 暴露选择

需要支持 method 级选择，同时提供“选择全部”的简化机制。

模型：

- capset 绑定 instance 时，默认设置 `include_all_methods = true`，可显式关闭。
- 若 `include_all_methods = true`，在绑定时将当前 service 的所有 methods 展开为静态 method 列表。
- 若 `include_all_methods = false`，必须通过 method binding 显式选择 method。
- streaming methods 只会在 gRPC catalog、reflection 和 gRPC 调用路径中可见；Connect RPC、MCP 和 OpenAPI 会跳过它们。

`capset add-instance` 的默认全部选择使用静态展开，而不是动态包含未来新增 method。这样 capset 暴露能力更可控，生成给 agent 的调用文档也更稳定。service package 更新后，新增 method 需要用户显式加入 capset。

service 更新不会自动重写 capset 的 method binding。如果新 descriptor 中删除了已绑定 method，或该 method 从 unary 变为 streaming，该 binding 会变成无效 binding：

- catalog / MCP tools/list 不再把它作为可调用能力暴露。
- 直接调用该 method 返回 `NOT_FOUND` 或 `UNIMPLEMENTED`。
- CLI 在 service update 输出和 capset 检查命令中展示这些无效 binding。

这样 service 可以做 breaking update，但 Octobus 不隐式修改用户配置。

删除 capset 时，级联删除其 capset instance 和 method bindings，不影响 service 或 instance。

## 命名

`ServiceSet` 简化为 `capset`。

文档和 CLI 中统一使用小写 `capset`，数据库表使用 `capsets`。

`capset`、`service`、`instance` 标识要求使用人类可读的简短英文，并允许常用连接符，例如 `-` 和 `_`。

标识约束：

```text
^[a-zA-Z][a-zA-Z0-9_-]{0,62}$
```

示例：

- `dev`
- `release-agent`
- `gitlab`
- `gitlab-prod`
- `gitlab_test`

不单独设置 `agent_id` 字段。capset 的名称本身应该足以表达它面向哪个 agent 或使用场景，例如 `release-agent`、`security-review`。
