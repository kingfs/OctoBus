# QIANXIN FW SecGate3600 HTTP_X

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id qianxin-fw-secgate3600-http-x ./services//qianxin__fw-secgate3600-http-x
```

## Behavior

- `Login` maps to `GET /webui/login/auth` with the WebUI login query parameters.
- `BlockIP` maps to `POST /webui/blacklist/set?uuid=...` with JSON body `{ ip, mask, desc? }`.
- `UnblockIP` uses the same endpoint and adds `undo=1` to the JSON body.
- HTTP responses are returned as normalized `DeviceHttpResponse` objects, including status, response headers, raw body, parsed JSON when available, and effective URL.

## Local Checks

```bash
cd services
npm run validate -- --service-dir qianxin__fw-secgate3600-http-x
npm test -- --service-dir qianxin__fw-secgate3600-http-x --coverage
npm run pack:check
```
