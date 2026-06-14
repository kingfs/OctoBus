# Tencent TSec V2.5.1 Service Package

This package preserves legacy gRPC package and method names where applicable.

It keeps the legacy gRPC package and method names for compatibility:

- `Tencent_TSec_V251.Tencent_TSec_V251/AddPreciseBlack`
- `Tencent_TSec_V251.Tencent_TSec_V251/DeletePreciseBlack`
- `Tencent_TSec_V251.Tencent_TSec_V251/AddGlobalBlack`
- `Tencent_TSec_V251.Tencent_TSec_V251/DeleteGlobalBlack`

The package command is `tencent-tsec-v2-5-1`, and the service root is `services/tencent__tsec_v2-5-1`.

## Behavior

- Signs requests with HMAC-SHA1 using the block or unblock secret key.
- Supports precise blacklist add/delete and global blacklist add/delete.
- Validates IPv4 address fields, ban reason, threshold, and valid duration.
- Preserves Tencent TSec global blacklist success semantics: add accepts status codes `200` and `208`; delete accepts `200` and `210`.

## Configuration

Config fields:

- `host` or `baseUrl`: Tencent TSec API gateway URL including protocol and API path.
- `uuid`: caller business UUID.
- `timeoutMs`: upstream HTTP timeout in milliseconds.
- `headers`: optional extra HTTP headers.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: TLS verification aliases.

Secret fields:

- `block_secret_id` or `blockSecretId`
- `block_secret_key` or `blockSecretKey`
- `unblock_secret_id` or `unblockSecretId`
- `unblock_secret_key` or `unblockSecretKey`

## Import

```bash
octobus service import --id tencent-tsec-v2-5-1 ./services//tencent__tsec_v2-5-1
```

## Validation

```bash
cd services
npm run validate -- --service-dir tencent__tsec_v2-5-1
npm test -- --service-dir tencent__tsec_v2-5-1 --coverage
npm run pack:check
```
