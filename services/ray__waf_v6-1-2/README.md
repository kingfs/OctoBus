# RAY WAF V6.1.2

OctoBus service package for RAY WAF V6.1.2 blacklist APIs.

Service root: `services/ray__waf_v6-1-2`.

Import it into OctoBus with:

```bash
octobus service import --id ray-waf-v6-1-2 ./services//ray__waf_v6-1-2
```

## Configuration

Static connection details may be provided through config or secret bindings:

```json
{
  "restBaseUrl": "http://127.0.0.1:18081",
  "user": "api_user",
  "password": "SuperSecret",
  "skipTlsVerify": true
}
```

`host` and `baseUrl` are accepted as base URL aliases. `username` is accepted as a `user` alias.

## Methods

- `Login`: `GET /apicenter/login/?username=...&password=...`, returning the device `random` session token.
- `QueryBlacklist`: `GET /apicenter/?action=blacklist_query&username=...&random=...`.
- `BlockIP`: `POST /apicenter/?action=blacklist_update&username=...&random=...`.
- `UnblockIP`: `POST /apicenter/?action=blacklist_del&username=...&random=...`.

The service does not maintain sessions between calls. Callers should pass the `random` value returned by `Login` to query, block, and unblock requests.

## Request Examples

Block one IPv4:

```json
{
  "random": "x3ilv79je222bg4zaca57by45gwha212",
  "ip": "203.0.113.10"
}
```

Unblock by blacklist ID:

```json
{
  "random": "x3ilv79je222bg4zaca57by45gwha212",
  "ids": "6"
}
```

Errors map to legacy gRPC codes: `INVALID_ARGUMENT`, `PERMISSION_DENIED`, `FAILED_PRECONDITION`, `UNAVAILABLE`, and `UNKNOWN`.
