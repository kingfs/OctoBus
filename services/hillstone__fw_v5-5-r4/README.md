# Hillstone FW V5.5R4 OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id hillstone-fw-v5-5-r4 ./services//hillstone__fw_v5-5-r4
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/hillstone_fw_v5_5_r4.proto`: gRPC API definition.
- `config.schema.json`: Hillstone host, username, timeout, TLS, and extra header settings.
- `secret.schema.json`: Hillstone username and password settings.
- `src/hillstone-fw-v5-5-r4.js`: Hillstone login and address-book implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/hillstone-fw-v5-5-r4.js`: service-local executable entrypoint.
- `test/hillstone-fw-v5-5-r4.test.js`: node:test coverage for login payloads, cookie handling, address book serialization, query encoding, HTTP error mapping, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Hillstone HTTP API mock.

## Configuration

Every RPC accepts `host` in the request for legacy compatibility. New instances may also place login defaults in config/secret bindings.

```json
{
  "host": "https://203.0.113.10:8443",
  "user_name": "hillstone-admin",
  "timeoutMs": 5000,
  "headers": {
    "X-Custom": "value"
  }
}
```

```json
{
  "password": "base64-or-legacy-encoded-password"
}
```

## RPC Methods

- `HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/Login`
- `HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/CreateAddressGroup`
- `HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/UpdateAddressGroup`
- `HILLSTONE_FW_V55R4.HILLSTONE_FW_V55R4/QueryAddressGroup`

## Behavior Notes

- `Login` posts Hillstone `userName`, `password`, `ifVsysId`, `vrId`, and `lang` fields. The password is passed through unchanged.
- Address-group create, update, and query RPCs require the caller to provide the full Hillstone cookie context.
- Create and update serialize the full `address_books` array, including optional `range`, `entry`, and `host` arrays.
- HTTP 2xx responses return gRPC OK with raw `http_status` and `http_body`.
- HTTP 401 and 403 map to `PERMISSION_DENIED`; other 4xx statuses map to `FAILED_PRECONDITION`; 5xx and network failures map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir hillstone__fw_v5-5-r4
npm test -- --service-dir hillstone__fw_v5-5-r4 --coverage
npm run pack:check
```
