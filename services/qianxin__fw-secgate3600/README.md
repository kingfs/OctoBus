# QIANXIN FW SecGate3600

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id qianxin-fw-secgate3600 ./services//qianxin__fw-secgate3600
```

## Behavior

- `Login` maps to `POST /v1.0/login` and caches the returned token plus cookies per engine instance and host.
- `UpdateAddressGroup` maps to `POST /v1.0/rest/`, requires a prior successful `Login`, and sends the normalized object-address payload as a JSON array.
- `Logout` maps to `POST /v1.0/out`, reuses the cached cookie header, and clears the cached session.
- Device JSON responses are returned even when the HTTP status is an upstream error; transport, empty-body, malformed JSON, and invalid schema errors return non-OK gRPC errors.

## Local Checks

```bash
cd services
npm run validate -- --service-dir qianxin__fw-secgate3600
npm test -- --service-dir qianxin__fw-secgate3600 --coverage
npm run pack:check
```
