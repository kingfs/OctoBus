# Error Model

## 目标

Octobus 需要让 agent 能稳定理解失败原因。gRPC、Connect RPC、MCP 三种入口应尽量使用同一套错误语义。

## gRPC

gRPC 入口直接返回标准 gRPC status code。

常见场景：

- capset / service / instance 不存在：`NOT_FOUND`
- method 不存在：`NOT_FOUND`
- method 未被 capset 暴露：`NOT_FOUND`
- method 是 streaming，当前目标不支持：`UNIMPLEMENTED`
- Node package 未实现 method：`UNIMPLEMENTED`
- request 参数非法：`INVALID_ARGUMENT`
- 后端实例不可用：`UNAVAILABLE`
- 调用超时：`DEADLINE_EXCEEDED`
- 未知内部错误：`INTERNAL` 或 `UNKNOWN`

由于新实现明确去掉鉴权，method 未暴露不使用 `PERMISSION_DENIED`，统一按 `NOT_FOUND` 处理。

## Connect RPC

Connect RPC 错误响应使用 Connect HTTP 错误模型：

```json
{
  "code": "unimplemented",
  "message": "method gitlab.MergeRequestService/List is not implemented"
}
```

HTTP status 映射：

| gRPC code | HTTP status |
| --- | --- |
| `INVALID_ARGUMENT` | `400` |
| `NOT_FOUND` | `404` |
| `UNIMPLEMENTED` | `501` |
| `UNAVAILABLE` | `503` |
| `DEADLINE_EXCEEDED` | `504` |
| `RESOURCE_EXHAUSTED` | `429` |
| `INTERNAL` | `500` |
| `UNKNOWN` | `500` |

## MCP

MCP tool error 使用 tool result 内错误，而不是协议层 error。

`structuredContent` 格式：

```json
{
  "error": {
    "code": "UNIMPLEMENTED",
    "message": "method gitlab.MergeRequestService/List is not implemented",
    "details": {}
  }
}
```

同时 `content` 中提供同一错误对象的 JSON 文本，兼容只读取文本内容的 MCP client。

## 未实现 method

Octobus 允许 package 未实现 proto 中的某些 unary methods。

调用未实现 method 时，Node service 返回：

```text
UNIMPLEMENTED: method gitlab.MergeRequestService/List is not implemented by package gitlab-wrapper@1.2.3
```

Octobus 对 Connect RPC / MCP 调用透传并转换该错误。
