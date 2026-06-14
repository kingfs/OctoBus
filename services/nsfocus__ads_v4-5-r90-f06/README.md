# NSFOCUS ADS V4.5R90F06

This package preserves legacy gRPC package and method names where applicable.

The legacy proto package spelling is preserved as `Nsfcous_ADS_V45R90F06` because it is part of the external gRPC method path.

## Import

```bash
octobus service import --id nsfocus-ads-v4-5-r90-f06 ./services//nsfocus__ads_v4-5-r90-f06
```

## Behavior

- `BlockIP` calls `/facade/unifiedInterface.php` with `target=blackList` and `action_type=add`.
- `UnblockIP` calls the same upstream path with `action_type=delete`.
- `restBaseUrl` or `baseUrl` and `key` are read from bindings/config/secret.
- `BlockIP` treats `content.actionErrors[0]` containing `记录已在黑名单中` as idempotent success.

## Local Checks

```bash
cd services
npm run validate -- --service-dir nsfocus__ads_v4-5-r90-f06
npm test -- --service-dir nsfocus__ads_v4-5-r90-f06 --coverage
npm run pack:check
```
