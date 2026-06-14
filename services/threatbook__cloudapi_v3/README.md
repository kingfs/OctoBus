# ThreatBook CloudAPI V3

OctoBus service package for ThreatBook CloudAPI V3 IP reputation and domain query APIs.

## Import

Service root: `services/threatbook__cloudapi_v3`.

```bash
octobus service import --id threatbook-cloudapi-v3 ./services//threatbook__cloudapi_v3
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/threatbook_cloudapi_v3.proto`: Legacy-compatible gRPC API.
- `src/threatbook-cloudapi-v3.js`: Runtime handlers, request building, response parsing, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: API key schema.
- `test/`: Node test coverage and mock upstream.

## Bindings

Configuration:

- `threatbook_domain`: ThreatBook base URL, for example `https://api.threatbook.cn`.
- `domain`, `restBaseUrl`, `baseUrl`: aliases for `threatbook_domain`.
- `timeoutMs`: optional request timeout in milliseconds, default `1500`.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: optional TLS verification skip aliases.

Secrets:

- `threatbook_apikey`: ThreatBook CloudAPI API key.
- `apikey`, `apiKey`: aliases for `threatbook_apikey`.

## RPC Methods

- `ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/IpReputation`
- `ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/DomainQuery`

## Behavior

- `IpReputation` calls `GET {threatbook_domain}/1.1.1/scene/ip_reputation`.
- `DomainQuery` calls `GET {threatbook_domain}/1.1.1/domain/query`.
- `lang` defaults to `zh`.
- `DomainQuery.exclude` defaults to `cas`.
- Success requires HTTP `200` and ThreatBook `response_code == 0`.
- Successful RPC responses return `http_status`, `raw_body`, and parsed `raw_json`.

Errors preserve the legacy structured JSON message convention:

- Missing arguments: `INVALID_ARGUMENT`.
- HTTP `401` / `403`: `PERMISSION_DENIED`.
- Other HTTP `4xx`: `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, and response read errors: `UNAVAILABLE`.
- Invalid JSON or missing `response_code`: `UNKNOWN`.
- HTTP `200` with `response_code != 0`: `FAILED_PRECONDITION`.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__cloudapi_v3
npm test -- --service-dir threatbook__cloudapi_v3 --coverage
npm run pack:check
```
