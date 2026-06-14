# TopSec FW V3.7.6

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id topsec-fw-v3-7-6 ./services//topsec__fw_v3-7-6
```

## Behavior

- `Login` maps to `POST /home/restLogin/`; it encrypts `password` and `ngtosAuth` with AES-CBC zero padding using configured AES key and IV, then extracts token, secret, user mark, and cookies.
- `AddBlacklistIP` maps to `POST /home/default/blackWhite/whiteIpAdd/`; it builds TopSec command arrays, signs `codeRun = md5(secret + token + path + commands)`, and treats duplicate entries as success.
- `DeleteBlacklistIP` maps to `POST /home/default/blackListSpread/deleteLots/`; it signs the same `codeRun` pattern and treats already-absent entries as success.
- `Logout` maps to `GET /home/restLogout/` and returns vendor payload when successful.
- HTTP statuses outside `200`, `201`, `204`, `209`, and `210` are mapped to gRPC errors.

## Local Checks

```bash
cd services
npm run validate -- --service-dir topsec__fw_v3-7-6
npm test -- --service-dir topsec__fw_v3-7-6 --coverage
npm run pack:check
```
