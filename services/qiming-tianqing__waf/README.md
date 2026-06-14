# Qiming Tianqing WAF

OctoBus service package for Qiming Tianqing WAF IP block and unblock orchestration.

Service root: `services/qiming-tianqing__waf`.

Import it into OctoBus with:

```bash
octobus service import --id qiming-tianqing-waf ./services//qiming-tianqing__waf
```

The package preserves the legacy flow:

- `BlockIP`: login, optionally create an address object for each IP, add each IP to the blacklist, then logout by default.
- `UnblockIP`: login, delete each IP from the blacklist, then logout by default.

## Configuration

Instance config or request credentials may provide:

```json
{
  "baseUrl": "http://127.0.0.1:19090",
  "username": "demo",
  "password": "secret",
  "skipTlsVerify": true
}
```

`restBaseUrl`, `base_url`, and `url` are accepted as base URL aliases. `password_sha256` and `passwordSha256` are accepted when a precomputed SHA-256 password digest is already available.

## Request Examples

Block IPs:

```json
{
  "ip_list": ["192.0.2.10"],
  "blacklist": {
    "name": "octobus-blacklist",
    "reason": "manual block"
  }
}
```

Unblock IPs:

```json
{
  "ip_list": ["192.0.2.10"],
  "blacklist": {
    "name": "octobus-blacklist"
  },
  "logout": false
}
```

`address_object.template_override`, `blacklist.template_override`, and `unblock.template_override` may override the JSON payload templates. Template placeholders include `{{ip}}`, `{{address_object_name}}`, `{{description}}`, `{{reason}}`, `{{blacklist_name}}`, `{{ip_list}}`, and `{{ip_list_json}}`.
