# Hillstone FW V5.5R6

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id hillstone-fw-v5-5-r6 ./services//hillstone__fw_v5-5-r6
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir hillstone__fw_v5-5-r6
npm test -- --service-dir hillstone__fw_v5-5-r6 --coverage
npm run pack:check
```
