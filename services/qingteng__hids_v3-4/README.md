# QingTeng HIDS V3.4

OctoBus service package for QingTeng HIDS V3.4 login, host asset query, and host isolation APIs.

Service root: `services/qingteng__hids_v3-4`.

Import it into OctoBus with:

```bash
octobus service import --id qingteng-hids-v3-4 ./services//qingteng__hids_v3-4
```

## Configuration

Credentials are read from instance config/secret bindings, matching the legacy engine service:

```json
{
  "host": "https://qingteng.example.com",
  "username": "qt-user",
  "password": "qt-pass",
  "skipTlsVerify": true
}
```

`restBaseUrl` and `baseUrl` are accepted as `host` aliases. `user` is accepted as a `username` alias.

## Methods

- `Login`: performs one login and returns the downstream HTTP status and raw body.
- `QueryHostAssets`: signs and sends `GET /external/api/assets/host/{linux|win}?ip=...`.
- `CreateHostIsolation`: signs and sends a create-isolation request with `direction=all`.
- `DeleteHostIsolation`: signs and sends a delete-isolation request.

Non-login methods cache the login session per instance and host, and retry once after HTTP 401 or 403 by forcing a fresh login.

## Requests

Query assets:

```json
{
  "ip": "10.0.0.1",
  "system_type": "linux"
}
```

Create isolation:

```json
{
  "agent_ids": ["agent-1", "agent-2"],
  "remark": "manual isolation"
}
```

Delete isolation:

```json
{
  "agent_ids": ["agent-1"]
}
```

Errors preserve the legacy JSON message payload with `code`, `message`, `http_status`, `raw_body`, and `reason`.
