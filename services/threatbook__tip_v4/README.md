# ThreatBook TIP V4

OctoBus service package for ThreatBook TIP V4 IP reputation queries.

## Import

Service root: `services/threatbook__tip_v4`.

```bash
octobus service import --id threatbook-tip-v4 ./services//threatbook__tip_v4
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/threatbook_tip_v4.proto`: Legacy-compatible gRPC API.
- `src/threatbook-tip-v4.js`: Runtime handler, request validation, HTTP request building, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: API key schema.
- `test/`: Node test coverage and mock upstream.

## Bindings

Configuration:

- `threatbook_domain`: ThreatBook TIP base URL, for example `https://api.threatbook.cn`.
- `domain`, `restBaseUrl`, `baseUrl`: aliases for `threatbook_domain`.
- `timeoutMs`: optional request timeout in milliseconds, default `1500`.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: optional TLS verification skip aliases.

Secrets:

- `threatbook_apikey`: ThreatBook TIP API key.
- `apikey`, `apiKey`: aliases for `threatbook_apikey`.

## RPC Methods

- `ThreatBook_TIP_V4.ThreatBook_TIP_V4/QueryIPReputation`

## Behavior

- Calls `GET {threatbook_domain}/tip_api/v4/ip`.
- Sends query parameters `apikey`, `lang=zh`, and `resource`.
- Any HTTP `2xx` response returns gRPC OK with `http_status` and raw `http_body`.
- HTTP `200` with `response_code != 0` is still gRPC OK, matching legacy behavior.
- HTTP `401` / `403` maps to `PERMISSION_DENIED`.
- Other HTTP `4xx` maps to `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, and response read errors map to `UNAVAILABLE`.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__tip_v4
npm test -- --service-dir threatbook__tip_v4 --coverage
npm run pack:check
```
