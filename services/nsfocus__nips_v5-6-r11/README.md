# NSFOCUS NIPS V5.6R11

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id nsfocus-nips-v5-6-r11 ./services//nsfocus__nips_v5-6-r11
```

## Behavior

- `Login` maps to `POST /api/system/account/login/login` and caches cookie, `api_key`, and `security_key` per instance.
- `BlockIP`, `ListBlacklist`, `UnblockByIds`, and `ApplyConfig` require a prior `Login`.
- Signed query parameters are generated from `security_key`, `api_key`, timestamp, and REST URI.
- Any HTTP response with a non-empty JSON body returns gRPC OK; transport, empty-body, and JSON parsing errors return non-OK gRPC errors.

## Local Checks

```bash
cd services
npm run validate -- --service-dir nsfocus__nips_v5-6-r11
npm test -- --service-dir nsfocus__nips_v5-6-r11 --coverage
npm run pack:check
```
