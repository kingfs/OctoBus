# TopSec FW 5U

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id topsec-fw-5u ./services//topsec__fw-5u
```

## Behavior

- `Login` maps to `POST /home/login/`; the service encrypts plaintext password with AES-128-CBC, key and IV `1111111111111111`, zero padding, Base64 output, and outer single quotes.
- `Refresh` maps to `POST /home/index/?userMark=...`.
- `AddToBlacklist` maps to `POST /home/default/blackListSpread/addTuple/?userMark=...` and handles exactly one IP.
- `RemoveFromBlacklist` maps to `POST /home/default/blackListSpread/deleteLots/?userMark=...` and handles exactly one IP.
- `Logout` maps to `GET /home/index/logout/?userMark=...&token=...`.
- TopSec token-prefixed bodies in the form `?{token}---{base64-json}` are decoded and returned as `raw_json`.
- Duplicate add results such as `黑名单条目已存在` and missing remove results such as `黑名单索引不存在` are treated as idempotent success.

## Session

`Login` returns an explicit `SessionContext`. Callers pass the latest session to `Refresh`, `AddToBlacklist`, `RemoveFromBlacklist`, and `Logout`. Token rotation is reflected in the returned session.

## Local Checks

```bash
cd services
npm run validate -- --service-dir topsec__fw-5u
npm test -- --service-dir topsec__fw-5u --coverage
npm run pack:check
```
