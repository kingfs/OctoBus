# ThreatBook TDP

OctoBus service package for ThreatBook TDP domain block and unblock APIs.

## Import

Service root: `services/threatbook__tdp`.

```bash
octobus service import --id threatbook-tdp ./services//threatbook__tdp
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/threatbook_tdp.proto`: Legacy-compatible gRPC API.
- `src/threatbook-tdp.js`: Runtime handlers, request validation, signing, response parsing, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: API key and HMAC secret schema.
- `test/`: Node test coverage and mock upstream.

## Bindings

Configuration:

- `restBaseUrl`: ThreatBook TDP base URL.
- `baseUrl`: alias for `restBaseUrl`.
- `timeoutMs`: optional request timeout in milliseconds, default `2000`.
- `skipTlsVerify`, `tlsInsecureSkipVerify`: optional TLS verification skip aliases.
- `headers`: optional additional HTTP headers.

Secrets:

- `api_key`: ThreatBook TDP API key.
- `apiKey`: alias for `api_key`.
- `secret`: HMAC-SHA256 secret.
- `Secret`: legacy alias for `secret`.

## RPC Methods

- `ThreatBook_TDP.ThreatBook_TDP/BlockDomain`
- `ThreatBook_TDP.ThreatBook_TDP/UnblockDomain`

## Behavior

- Both RPCs call `POST /api/v1/linkage_block/deny_list/operate`.
- `BlockDomain` sends `operate: "add"`.
- `UnblockDomain` sends `operate: "delete"`.
- `block_direction` is always `out`.
- Every request appends `api_key`, `auth_timestamp`, and URL-safe HMAC-SHA256 `sign` query parameters.
- Successful HTTP statuses are `200`, `201`, `204`, `209`, and `210`.
- Success with an empty body returns `data: null`.
- Success with JSON returns the parsed upstream JSON as `google.protobuf.Value`.
- HTTP `401` / `403` maps to `PERMISSION_DENIED`.
- Other HTTP `4xx` maps to `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, and response read errors map to `UNAVAILABLE`.
- Invalid JSON on a successful HTTP status maps to `UNKNOWN`.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__tdp
npm test -- --service-dir threatbook__tdp --coverage
npm run pack:check
```
