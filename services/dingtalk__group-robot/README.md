# DingTalk Group Robot OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id dingtalk-group-robot ./services//dingtalk__group-robot
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/dingtalk_group_robot.proto`: gRPC API definition.
- `config.schema.json`: non-secret webhook URL, signing-secret alias, and timeout settings.
- `secret.schema.json`: DingTalk signing secret fields.
- `src/dingtalk-group-robot.js`: DingTalk webhook implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/dingtalk-group-robot.js`: service-local executable entrypoint.
- `test/dingtalk-group-robot.test.js`: node:test coverage for validation, signing, payload construction, HTTP behavior, and SDK handler invocation.
- `test/mock_upstream.js`: optional local DingTalk webhook mock.

## Configuration

Use `webhook_url` for the DingTalk custom robot webhook URL. Legacy aliases `webhookUrl`, `webhook`, and `url` are also accepted.

```json
{
  "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=replace-me",
  "timeoutMs": 5000
}
```

Use `secret.secret` or `secret.dingding_secret` for the DingTalk signing secret when the robot has signing enabled:

```json
{
  "secret": "replace-with-signing-secret"
}
```

## RPC Methods

- `DingDing_GroupRobot.DingDing_GroupRobot/SendTextMessage`

## Behavior Notes

- Only DingTalk `msgtype: "text"` messages are sent.
- `send_msg` is required.
- `send_PeoplePhone` and `send_DingDingID` accept arrays, protobuf repeated value wrappers, or comma-separated strings through legacy aliases.
- When `secret` is configured, the service appends DingTalk `timestamp` and URL-encoded HMAC-SHA256 `sign` query parameters.
- HTTP 2xx responses return gRPC OK and preserve the raw response body, even if DingTalk `errcode` is nonzero.
- HTTP non-2xx responses return a gRPC error with `httpStatus` and `httpBody` attached.
- Network failures map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir dingtalk__group-robot
npm test -- --service-dir dingtalk__group-robot --coverage
npm run pack:check
```
