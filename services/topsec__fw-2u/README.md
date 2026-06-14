# TopSec FW 2U

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id topsec-fw-2u ./services//topsec__fw-2u
```

## Behavior

- `Login` maps to `POST /home/login/addNoCode/`; the service encrypts the plaintext password as AES-CBC with key and IV `ngfwrestapilogin`, zero padding, and Base64 output.
- `ActivatePermission` maps to `POST /home/index/?userMark=...`.
- `AddBlacklistIP` maps to `POST /home/default/blackListSpread/addTuple/?userMark=...`.
- `DeleteBlacklistIP` maps to `POST /home/default/blackListSpread/deleteLots/?userMark=...`.
- `Logout` maps to `GET /home/index/logout/?userMark=...&token=...`.
- HTTP responses are returned with `status_code` and `raw_body` even for non-2xx statuses. gRPC errors are only used for invalid input, network failures, and unreadable UTF-8 response bodies.

## Session

Callers keep `SessionContext` between RPC calls:

- `token`
- `user_mark`
- `cookie`
- `secret`

`Login` parses session values from the response token, response body, and cookies. `AddBlacklistIP` and `DeleteBlacklistIP` return refreshed session data when the upstream response rotates the token.

## Local Checks

```bash
cd services
npm run validate -- --service-dir topsec__fw-2u
npm test -- --service-dir topsec__fw-2u --coverage
npm run pack:check
```
