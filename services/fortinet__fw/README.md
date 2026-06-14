# Fortinet FW OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Import it into OctoBus with:

```bash
octobus service import --id fortinet-fw ./services//fortinet__fw
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/fortinet_fw.proto`: gRPC API definition.
- `config.schema.json`: Fortinet API endpoint, vdom, timeout, TLS, and extra header settings.
- `secret.schema.json`: Fortinet API token settings.
- `src/fortinet-fw.js`: Fortinet firewall address and address group implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/fortinet-fw.js`: service-local executable entrypoint.
- `test/fortinet-fw.test.js`: node:test coverage for validation, request mapping, HTTP behavior, idempotent Fortinet errors, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Fortinet firewall API mock.

## Configuration

Use `host` or `restBaseUrl` for the Fortinet REST API base URL. Aliases `rest_base_url`, `baseUrl`, `base_url`, and `endpoint` are also accepted.

```json
{
  "restBaseUrl": "https://fortinet.example:8443",
  "is_vdom": true,
  "vdom": "root",
  "timeoutMs": 5000,
  "headers": {
    "X-Custom": "value"
  }
}
```

Use `token` for the Fortinet bearer token. Aliases `accessToken` and `access_token` are also accepted.

```json
{
  "token": "replace-with-api-token"
}
```

## RPC Methods

- `Fortinet_FW.Fortinet_FW/CreateAddress`
- `Fortinet_FW.Fortinet_FW/GetAddress`
- `Fortinet_FW.Fortinet_FW/DeleteAddress`
- `Fortinet_FW.Fortinet_FW/CreateAddrGroup`
- `Fortinet_FW.Fortinet_FW/GetAddrGroup`
- `Fortinet_FW.Fortinet_FW/AddAddrGroupMember`
- `Fortinet_FW.Fortinet_FW/RemoveAddrGroupMember`
- `Fortinet_FW.Fortinet_FW/DeleteAddrGroup`
- `Fortinet_FW.Fortinet_FW/AttachSubGroupToPolicyAddrGroup`
- `Fortinet_FW.Fortinet_FW/DetachSubGroupFromPolicyAddrGroup`

## Behavior Notes

- Address object names are the same as the IP text.
- `CreateAddrGroup` creates each member address object before creating the group.
- `AddAddrGroupMember` creates the target address object before adding it to the group.
- Fortinet error `-5` is treated as idempotent success for address creation and member add operations.
- Fortinet error `-23` is preserved as a continue-able response for address deletion.
- Removing a missing group member with payload `http_status: 404` is treated as idempotent success.
- Attach and detach operations read the current policy address group members, then update the merged or filtered member list.
- HTTP 401 and 403 map to `PERMISSION_DENIED`; other 4xx statuses map to `FAILED_PRECONDITION`; 5xx and network failures map to `UNAVAILABLE`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir fortinet__fw
npm test -- --service-dir fortinet__fw --coverage
npm run pack:check
```
