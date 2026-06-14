# Node Runtime

## 当前结论

Go 程序使用本机子进程启动 Node.js service package。每个 service 对应一个 npm-compatible package，该 package 自身 serve 具体 gRPC service instance。

JS 侧不设计为“通用 Node runtime 加载任意 JS 文件”，而是 package contract：package 提供 `service.json`、根 `package.json bin`、proto、实现和 `--runtime serve` / `--runtime invoke` 协议。`@chaitin-ai/octobus-sdk` 帮助开发者实现这些协议。

## Go -> Node 启动协议

Go 创建或恢复 long-running instance 时：

- 分配本地端口。
- 写入 instance config JSON 和 secret JSON。
- 从 service runtime dir 启动 `package.json bin` 解析出的 `node_entry`。
- 通过 CLI 参数传递监听地址、端口、config、secret、workdir、service id 和 instance id。
- 通过 env 传递 OctoBus 运行时标识。
- 使用独立 instance workdir 作为子进程 cwd。

启动命令形态：

```text
{data_dir}/artifacts/services/{service_id}/runtime/<node_entry> --runtime serve \
  --host 127.0.0.1 \
  --port 41001 \
  --config /path/to/instance.json \
  --secret /path/to/secret.json \
  --workdir /path/to/instances/gitlab-test \
  --service gitlab \
  --instance gitlab-test
```

实际启动时：

- `cwd` 设置为 `{data_dir}/instances/{instance_id}`。
- `<node_entry>` 必须是 runtime dir 内存在的普通文件，不回退到 `PATH`。
- `--config` 指向 `{data_dir}/instances/{instance_id}/config.json`。
- `--secret` 指向 `{data_dir}/instances/{instance_id}/secret.json`。
- `--workdir` 指向 `{data_dir}/instances/{instance_id}`。
- `--service` 是 OctoBus service id。
- `--instance` 是 OctoBus instance id。

同一个 service 的多个 instance 共享 runtime dir，但每个 instance 有自己的 workdir。

instance workdir 用于：

- config.json
- secret.json
- stdout.log / stderr.log
- 临时文件
- cookie/session/cache
- 运行状态文件

运行时环境变量：

```text
OCTOBUS_SERVICE_ID=<service_id>
OCTOBUS_INSTANCE_ID=<instance_id>
OCTOBUS_PACKAGE_DIR={data_dir}/artifacts/services/{service_id}/runtime/<service_root>
OCTOBUS_DESCRIPTOR_PATH={data_dir}/artifacts/services/{service_id}/descriptor.protoset
OCTOBUS_DESCRIPTOR_SHA256=<sha256>
```

`service_root` 是导入 source 的 `//service-dir` 选择结果，未指定时为 `"."`。SDK 优先从 `OCTOBUS_PACKAGE_DIR` 读取 service root 下的 `service.json`，因此 runtime dir 可以保存完整 distribution package。

## Node 职责

Node service package 至少需要：

- 提供 `service.json`，声明 proto roots/files、runtime mode 和可选 config / secret schema。
- 提供根 `package.json bin`，声明 runtime entry；多 service package 中 `service.json.name` 必须匹配根 `bin` object 的 key。
- 提供 `--runtime serve --host ... --port ... --config ... --secret ...`，启动 gRPC server。
- 对 on-demand service，提供 `--runtime invoke --method ... --config ... --secret ... --metadata ...`。
- 加载 package 内 proto。
- 注册 gRPC server。
- 执行业务 handler。
- 对未实现 unary method 返回 `UNIMPLEMENTED`。
- 监听指定 host/port。
- 支持标准 gRPC health check。SDK 默认实现，非 SDK package 也必须实现。

`inspect --json` 不作为 import 协议。它可以作为 SDK/package 的开发调试能力，但 OctoBus import 的权威事实来源是 `service.json`、`package.json bin` 和 Go 侧编译出的 descriptor。

## Go 职责

Go NodeSupervisor 负责：

- 进程启动与停止。
- stdout / stderr 日志采集。
- 状态更新。
- 健康检查。
- 退出检测。
- daemon 重启后的自动恢复。
- 启动时保证子进程 cwd 是 instance workdir，避免多个 instance 共享运行状态。
- 使用 `grpc.health.v1.Health/Check service=""` 判断 ready。端口连通和 stdout ready line 不能替代 health check。

## 限制

OctoBus 当前公共数据面支持范围：

- long-running service 的 gRPC 网关支持 unary、server streaming、client streaming 和 bidirectional streaming。
- Connect RPC、MCP、本地 service CLI 和 on-demand `--runtime invoke` 只支持 unary methods。

如果 proto 中包含 streaming method，service 导入时会记录 method metadata；这些 methods 只适用于 long-running gRPC 调用，不进入 Connect RPC、MCP 或 on-demand 调用路径。

更多 package contract 见 [service-package.md](service-package.md)。
