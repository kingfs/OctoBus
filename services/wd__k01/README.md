# WD K01

This package preserves legacy gRPC package and method names where applicable.

The legacy service and repository search only identify the product as `WD_K01`; public search did not find a more authoritative full vendor name. This package keeps the planned `wd__k01` root and `wd-k01` command while preserving the legacy proto package and RPC names.

## Import

```bash
octobus service import --id wd-k01 ./services//wd__k01
```

## Behavior

- `BlockIP` logs in with `POST /api/cms/user/login`, calls `POST /api/v1/security/iplist/save` with `method: "add"`, then logs out with `POST /api/cms/user/logout`.
- `UnblockIP` logs in, calls the same save endpoint with `method: "delete"`, then logs out.
- Block messages containing `已存在` or `多播地址` are treated as idempotent success.
- Unblock messages containing `对象不存在` or `多播地址` are treated as idempotent success.
- `UnblockIP` accepts `1.1.1.1` or `1.1.1.1/32`; when the mask is omitted, `/32` is used.
- HTTP 401/403 maps to `PERMISSION_DENIED`, other 4xx maps to `FAILED_PRECONDITION`, and network failures map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir wd__k01
npm test -- --service-dir wd__k01 --coverage
npm run pack:check
```
