# Hillstone FW V5.5R10 OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id hillstone-fw-v5-5-r10 ./services//hillstone__fw_v5-5-r10
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/hillstone_fw_v5_5_r10.proto`: gRPC API definition.
- `config.schema.json`: Hillstone host, username, timeout, TLS, and extra header settings.
- `secret.schema.json`: Hillstone username and password settings.
- `src/hillstone-fw-v5-5-r10.js`: Hillstone login and address-book implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/hillstone-fw-v5-5-r10.js`: service-local executable entrypoint.
- `test/hillstone-fw-v5-5-r10.test.js`: node:test coverage for login/session caching, address group mutations, query encoding, HTTP body wrapping, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Hillstone HTTP API mock.

## Configuration

Every RPC accepts `host` in the request for legacy compatibility. New instances may also place `host`, `username`, and `password` in config/secret bindings.

```json
{
  "host": "https://203.0.113.10:8443",
  "username": "api_user",
  "timeoutMs": 5000,
  "headers": {
    "X-Custom": "value"
  }
}
```

```json
{
  "password": "replace-with-password"
}
```

## RPC Methods

- `HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/Login`
- `HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/AddAddressGroup`
- `HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/OverwriteAddressGroup`
- `HILLSTONE_FW_V55R10.HILLSTONE_FW_V55R10/QueryAddressGroup`

## Behavior Notes

- `Login` posts fixed Hillstone login fields and caches the latest successful session by OctoBus instance and host.
- Address-group mutation and query RPCs require a prior successful `Login` for the same instance and host.
- Upstream HTTP failures still return gRPC OK and preserve upstream `http_status` and response body semantics, matching the legacy service.
- HTTP 401 and 403 on address-book calls clear the cached session.
- JSON upstream bodies are returned as protobuf `Value`; non-JSON bodies are preserved in `raw_text`.
- `host` must be an HTTP or HTTPS URL with an explicit port and no path, query, or fragment.

## Local Checks

```bash
cd services
npm run validate -- --service-dir hillstone__fw_v5-5-r10
npm test -- --service-dir hillstone__fw_v5-5-r10 --coverage
npm run pack:check
```
