# Feishu Group Robot OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id feishu-group-robot ./services//feishu__group-robot
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/feishu_group_robot.proto`: gRPC API definition.
- `config.schema.json`: webhook URL, timeout, TLS, and extra header settings.
- `secret.schema.json`: placeholder schema for compatibility with package validation.
- `src/feishu-group-robot.js`: Feishu webhook implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/feishu-group-robot.js`: service-local executable entrypoint.
- `test/feishu-group-robot.test.js`: node:test coverage for validation, request mapping, HTTP behavior, network errors, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Feishu webhook mock.

## Configuration

Use `webhook` for the Feishu group robot webhook URL. Aliases `webhook_url`, `webhookUrl`, and `url` are also accepted.

```json
{
  "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/replace-me",
  "timeoutMs": 5000,
  "headers": {
    "X-Custom": "value"
  }
}
```

## RPC Methods

- `Feishu_GroupRobot.Feishu_GroupRobot/SendTextMessage`

## Behavior Notes

- The request body is always Feishu `msg_type: "text"` with `content.text`.
- `message` is required. Legacy aliases `send_msg`, `sendMsg`, and `text` are accepted.
- HTTP statuses 200, 209, and 210 return gRPC OK and preserve `http_status` and `http_body`.
- Other HTTP statuses return `UNAVAILABLE` with the upstream status and body in the error message.
- Network failures map to `UNAVAILABLE`.
- The service sets `Content-Type`, `User-Agent`, `x-engine-instance`, and `x-request-id` headers while preserving configured extra headers.

## Local Checks

```bash
cd services
npm run validate -- --service-dir feishu__group-robot
npm test -- --service-dir feishu__group-robot --coverage
npm run pack:check
```
