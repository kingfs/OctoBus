# Venus ADS V3.6

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id venus-ads-v3-6 ./services//venus__ads_v3-6
```

## Behavior

- `BatchBlockIP` logs in with `POST /v2.0/api/web_login/ddos`, calls `POST /v2.0/api/ip_bwlist/info`, and logs out with `POST /v2.0/api/web_logout/ddos`.
- `RemoveBlockedIP` logs in, calls `DELETE /v2.0/api/ip_bwlist/info?listtype=...&iplist=...`, and logs out.
- `result == "0"` is success; block result `-391201` and remove result `-391204` are treated as idempotent success.
- HTTP 401/403 maps to `PERMISSION_DENIED`, other 4xx maps to `FAILED_PRECONDITION`, and network failures map to `UNAVAILABLE`.
- Bindings accept `baseUrl`, `restBaseUrl`, or `host`; `username` or `user`; `password` or `pass`; and optional headers, timeout, list type, direction, state, remark, and TLS settings.

## Local Checks

```bash
cd services
npm run validate -- --service-dir venus__ads_v3-6
npm test -- --service-dir venus__ads_v3-6 --coverage
npm run pack:check
```
