# Tencent QYWeiXin Group Robot Service Package

This package preserves legacy gRPC package and method names where applicable.

It keeps the legacy gRPC package and method name for compatibility:

- `Tencent_QYWeiXin_GroupRobot.Tencent_QYWeiXin_GroupRobot/SendText`

The package command is `tencent-qyweixin-group-robot`, and the service root is `services/tencent__qyweixin-group-robot`.

## Behavior

- Requires a full HTTPS WeCom webhook URL in the request `webhook` field.
- Sends request `message` as WeCom `text.content`.
- Supports comma-separated `mentioned_mobiles` and camelCase `mentionedMobiles`.
- Returns the upstream HTTP status, raw body, parsed `errcode`, and parsed `errmsg`.
- Maps non-2xx, invalid JSON, missing `errcode`, transport failures, and non-zero WeCom business codes to structured gRPC errors.

## Configuration

Config fields:

- `timeoutMs`: upstream HTTP timeout in milliseconds.
- `headers`: optional extra HTTP headers.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: TLS verification aliases.

This service has no required secret fields because the webhook carries the WeCom robot key.

## Import

```bash
octobus service import --id tencent-qyweixin-group-robot ./services//tencent__qyweixin-group-robot
```

## Validation

```bash
cd services
npm run validate -- --service-dir tencent__qyweixin-group-robot
npm test -- --service-dir tencent__qyweixin-group-robot --coverage
npm run pack:check
```
