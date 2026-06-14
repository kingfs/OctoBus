# RiverSafe WAF

OctoBus service package for RiverSafe WAF full IP blacklist synchronization.

Service root: `services/riversafe__waf`.

Import it into OctoBus with:

```bash
octobus service import --id riversafe-waf ./services//riversafe__waf
```

The legacy source directory was named `RiverSafeplusd_WAF`; no authoritative product naming evidence was found for `RiverSafeplusd`, and the legacy README describes the target as RiverSafe WAF. The package therefore uses the normalized service root `riversafe__waf` and command `riversafe-waf` while preserving the legacy protobuf package and RPC path for compatibility.

## Configuration

```json
{
  "host": "https://waf.example:20167",
  "token_id": "api_admin",
  "token": "token_value",
  "skipTlsVerify": true
}
```

`host` must be an HTTPS URL. It may include a base path and existing query parameters; those parameters are preserved and included in the canonical signing string.

## Request

```json
{
  "items": ["192.0.2.10", "198.51.100.0/24", "2607:f8b0:4005:809::200e"]
}
```

Plain IPv4 and IPv6 hosts are normalized to `/32` and `/128`. CIDR prefixes are validated.

## Behavior

- Sends `POST /api/v1/ip_black_list`.
- Signs requests with the RiverSafe token, token ID, timestamp, nonce, canonical URI/query, body MD5, and HMAC-SHA256.
- Treats HTTP `200`, `201`, `204`, `209`, and `210` as transport success, then requires JSON `err_no == 0`.
