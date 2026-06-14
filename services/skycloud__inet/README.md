# SKYCloud iNet Service Package

This package preserves legacy gRPC package and method names where applicable.

It keeps the legacy gRPC package and service name for compatibility:

- `SKYCloud_INET.SKYCloud_INET/BatchBlockIP`
- `SKYCloud_INET.SKYCloud_INET/BatchUnblockIP`

The package command is `skycloud-inet`, and the service root is `services/skycloud__inet`.

## Behavior

- Logs in to SKYCloud iNet with configured credentials.
- Resolves an environment by `environment_name`.
- Splits valid IP directives into batches of 300.
- Creates block or unblock work orders.
- Returns per-IP success or validation errors while preserving invalid IPs in the response.

## Configuration

Config fields:

- `host`, `restBaseUrl`, or `baseUrl`: SKYCloud iNet HTTPS base URL.
- `defaultDirection`: default ticket direction, usually `BOTH`.
- `timeoutMs`: upstream HTTP timeout in milliseconds.
- `headers`: optional extra HTTP headers.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: TLS verification aliases.
- `allowHttpBaseUrl`, `allowHttpHost`, `allowHttpUrl`: local mock-only HTTP aliases.

Secret fields:

- `username` or `user`
- `password`

Request `connection` can override host and credentials for a single call.

## Import

```bash
octobus service import --id skycloud-inet ./services//skycloud__inet
```

## Validation

```bash
cd services
npm run validate -- --service-dir skycloud__inet
npm test -- --service-dir skycloud__inet --coverage
npm run pack:check
```
