# DPtech UMC ADS V5.3.29 OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id dptech-umc-ads-v5-3-29 ./services//dptech__umc-ads_v5-3-29
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/dptech_umc_ads_v5_3_29.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, username, timeout, TLS, and extra header settings.
- `secret.schema.json`: DPtech UMC ADS password and optional username fields.
- `src/dptech-umc-ads-v5-3-29.js`: DPtech UMC ADS REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/dptech-umc-ads-v5-3-29.js`: service-local executable entrypoint.
- `test/dptech-umc-ads-v5-3-29.test.js`: node:test coverage for login caching, request mapping, token resolution, validation, error classification, and SDK handler invocation.
- `test/mock_upstream.js`: optional local DPtech UMC ADS HTTP mock.

## Configuration

Use `host` for the DPtech UMC ADS base URL. Legacy aliases `baseUrl`, `base_url`, `restBaseUrl`, `rest_base_url`, and `endpoint` are also accepted.

```json
{
  "host": "https://203.0.113.10:8443",
  "user": "api-user",
  "timeoutMs": 5000,
  "skipTlsVerify": false,
  "headers": {
    "X-Trace": "demo"
  }
}
```

Use `secret.password`, `secret.pass`, or `secret.secret` for the login secret key. `secret.user` or `secret.username` may carry the username when needed:

```json
{
  "password": "replace-with-secret-key"
}
```

## RPC Methods

- `DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/Login`
- `DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/QueryBlacklist`
- `DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/AddBlacklist`
- `DPtech_UMC_ADS_v5329.DPtech_UMC_ADS_v5329/DeleteBlacklist`

## Behavior Notes

- `Login` calls the UMC token API with `userName` and `secretKey`, then caches a successful token per OctoBus instance and host.
- `QueryBlacklist`, `AddBlacklist`, and `DeleteBlacklist` use a request `token` when provided, otherwise they require a prior successful `Login`.
- Upstream HTTP responses, including non-2xx statuses, are returned as gRPC OK payloads with `http_status`, `raw_body`, and `raw_json` when parsable.
- Network failures and local validation errors return gRPC errors.
- Add/delete requests accept 1 to 100 IPv4 or IPv6 addresses. CIDR and address ranges are rejected.
- Add requests generate `strategyName`, `protectionName`, and the fixed DPtech strategy fields used by the legacy service.
- Cached tokens are cleared when an upstream business RPC returns HTTP 401 or 403.

## Local Checks

```bash
cd services
npm run validate -- --service-dir dptech__umc-ads_v5-3-29
npm test -- --service-dir dptech__umc-ads_v5-3-29 --coverage
npm run pack:check
```
