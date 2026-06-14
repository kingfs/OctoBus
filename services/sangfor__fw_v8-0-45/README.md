# Sangfor FW V8.0.45 Service Package

This package preserves legacy gRPC package and method names where applicable.

It keeps the legacy gRPC package and service name for compatibility:

- `Sangfor_FW_V8045.Sangfor_FW_V8045/Login`
- `Sangfor_FW_V8045.Sangfor_FW_V8045/BlockIP`
- `Sangfor_FW_V8045.Sangfor_FW_V8045/UnblockIP`
- `Sangfor_FW_V8045.Sangfor_FW_V8045/Logout`

The package command is `sangfor-fw-v8-0-45`, and the service root is `services/sangfor__fw_v8-0-45`.

## Behavior

- `Login` posts `{name,password}` to `/api/v1/namespaces/public/login` and returns `data.loginResult.token`.
- `BlockIP` posts blacklist entries to `/api/batch/v1/namespaces/public/whiteblacklist` with `Cookie: token=<token>`.
- `UnblockIP` posts delete entries to `/api/batch/v1/namespaces/public/whiteblacklist?_method=delete`.
- `Logout` posts `{}` to `/api/v1/namespaces/public/logout`.
- Block success codes are `0` and `17`; unblock success codes are `0` and `1004`.

## Configuration

Config fields:

- `host`, `restBaseUrl`, or `baseUrl`: Sangfor FW HTTP(S) base URL.
- `timeoutMs`: upstream HTTP timeout in milliseconds.
- `headers`: optional extra HTTP headers.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: TLS verification aliases.

Secret fields:

- `user` or `username`
- `password`

## Import

```bash
octobus service import --id sangfor-fw-v8-0-45 ./services//sangfor__fw_v8-0-45
```

## Validation

```bash
cd services
npm run validate -- --service-dir sangfor__fw_v8-0-45
npm test -- --service-dir sangfor__fw_v8-0-45 --coverage
npm run pack:check
```
