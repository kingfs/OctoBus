# Panabit TANG-R1

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id panabit-tang-r1 ./services//panabit__tang-r1
```

## Behavior

- `Login` maps to `GET /api/panabit.cgi/API` with `api_action=api_login`.
- `ListIPTable`, `AddIPTable`, `BlockIP`, and `UnblockIP` map to `POST /api/panabit.cgi` with multipart form data.
- Business responses are passed through as device `code`, `msg`, and raw JSON struct fields.
- HTTP 401/403 map to `PERMISSION_DENIED`; other 4xx responses map to `FAILED_PRECONDITION`; 5xx and transport failures map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir panabit__tang-r1
npm test -- --service-dir panabit__tang-r1 --coverage
npm run pack:check
```
