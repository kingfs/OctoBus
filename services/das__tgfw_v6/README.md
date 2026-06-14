# DAS TGFW V6 OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id das-tgfw-v6 ./services//das__tgfw_v6
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/das_tgfw_v6.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, timeout, and TLS settings.
- `secret.schema.json`: DAS TGFW V6 API token fields.
- `src/das-tgfw-v6.js`: DAS TGFW V6 REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/das-tgfw-v6.js`: service-local executable entrypoint.
- `test/das-tgfw-v6.test.js`: node:test coverage for validation, REST mapping, error mapping, helper behavior, and SDK handler invocation.
- `test/mock_upstream.js`: optional local DAS TGFW V6 HTTP mock.

## Configuration

Use `host` for the DAS TGFW V6 management base URL. Legacy aliases `restBaseUrl`, `rest_base_url`, `baseUrl`, `base_url`, and `endpoint` are also accepted.

```json
{
  "host": "https://198.51.100.10:8443",
  "timeoutMs": 1500,
  "skipTlsVerify": false
}
```

Use `secret.api_token`, `secret.apiToken`, or `secret.token` for the downstream `AuthorizationToken` header:

```json
{
  "api_token": "replace-with-token"
}
```

## RPC Methods

- `DAS_TGFW_V6.DAS_TGFW_V6/query_blacklist`
- `DAS_TGFW_V6.DAS_TGFW_V6/add_blacklist`
- `DAS_TGFW_V6.DAS_TGFW_V6/delete_blacklist`

## Behavior Notes

- `query_blacklist` calls `GET {host}/api/v1/blacklist`.
- `add_blacklist` calls `POST {host}/api/v1/blacklist` with `{id:1,val:{...}}`.
- `delete_blacklist` calls `DELETE {host}/api/v1/blacklist`.
- Host and token are instance-level configuration or secret values and are not read from gRPC request fields.
- Missing host or token maps to `INVALID_ARGUMENT`.
- HTTP 401/403 maps to `PERMISSION_DENIED`.
- HTTP 4xx maps to `FAILED_PRECONDITION`.
- HTTP 5xx and network failures map to `UNAVAILABLE`.
- Add and delete require a 2xx response with `msg == "success"` when the response body is JSON.

## Local Checks

```bash
cd services
npm run validate -- --service-dir das__tgfw_v6
npm test -- --service-dir das__tgfw_v6 --coverage
npm run pack:check
```
