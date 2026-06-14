# Huawei FW USG6000E

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id huawei-fw-usg6000e ./services//huawei__fw-usg6000e
```

## Behavior

`UpdateAddressGroup` performs one HTTPS `PUT` to replace a Huawei USG6000E address group with the requested full IPv4/IPv6 set. Empty `ipv4_list` and `ipv6_list` clear the group. Preview metadata (`preview_only`, `previewOnly`, `x-preview-only`, or `dry_run_preview`) returns the sanitized request model without calling the upstream device.

## Local Checks

```bash
cd services
npm run validate -- --service-dir huawei__fw-usg6000e
npm test -- --service-dir huawei__fw-usg6000e --coverage
npm run pack:check
```
