# ThreatBook OneSIG

OctoBus service package for ThreatBook OneSIG inbound blacklist block, list, and unblock APIs.

## Import

Service root: `services/threatbook__onesig`.

```bash
octobus service import --id threatbook-onesig ./services//threatbook__onesig
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/threatbook_onesig.proto`: Legacy-compatible gRPC API.
- `src/threatbook-onesig.js`: Runtime handlers, request validation, signing, response parsing, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: API key and HMAC secret schema.
- `test/`: Node test coverage and mock upstream.

## Bindings

Configuration:

- `base_url`: ThreatBook OneSIG base URL. HTTPS is required unless `allow_http` is true.
- `baseUrl`: alias for `base_url`.
- `allow_http`, `allowInsecureHttp`: allow `http://` base URLs for local mock testing.
- `timeoutMs`: optional request timeout in milliseconds, default `1500`.
- `skipTlsVerify`, `tlsInsecureSkipVerify`: optional TLS verification skip aliases.
- `signature_mode`: optional signing payload mode, one of `apiKey+timestamp`, `timestamp+apiKey`, `apiKey`, `timestamp`.
- `timestamp_precision`: optional timestamp precision, `seconds` or `milliseconds`.
- `encode_sign`: optional boolean-like flag, defaults to true.
- `headers`: optional additional HTTP headers.

Secrets:

- `api_key`: ThreatBook OneSIG API key.
- `apiKey`: alias for `api_key`.
- `secret`: HMAC-SHA1 secret.
- `Secret`: legacy alias for `secret`.

## RPC Methods

- `ThreatBook_OneSIG.ThreatBook_OneSIG/BatchBlockIP`
- `ThreatBook_OneSIG.ThreatBook_OneSIG/ListInboundBlacklistEntries`
- `ThreatBook_OneSIG.ThreatBook_OneSIG/BatchUnblockByEntryIds`

## Behavior

- `BatchBlockIP` calls `POST /v3/blacklist/inbound`.
- `ListInboundBlacklistEntries` calls `POST /v3/blacklist/inbound/list`.
- `BatchUnblockByEntryIds` calls `DELETE /v3/blacklist/inbound`.
- Every request appends `apikey`, `timestamp`, and `sign` query parameters.
- Default signing payload is `apiKey + timestamp`; `sign` is Base64 HMAC-SHA1 using `secret`.
- Success requires HTTP `200` and OneSIG `responseCode == 0`.
- HTTP non-200 maps to `UNAVAILABLE`.
- `responseCode != 0` maps to `FAILED_PRECONDITION`.
- Invalid or empty JSON maps to `UNKNOWN`.

## Validation

```bash
cd services
npm run validate -- --service-dir threatbook__onesig
npm test -- --service-dir threatbook__onesig --coverage
npm run pack:check
```
