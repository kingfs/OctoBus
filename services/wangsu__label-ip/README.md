# Wangsu Label IP

This package preserves legacy gRPC package and method names where applicable.

## Import

```bash
octobus service import --id wangsu-label-ip ./services//wangsu__label-ip
```

## Behavior

- `BatchForbidIP` posts `{operationObjectList[{labelCode, ipList}], operationType: 1, forbidTime}` to the configured Wangsu OpenAPI endpoint.
- `BatchUnforbidIP` posts the same structure with `operationType: 2`; `forbidTime` is only sent when provided.
- Authentication uses `Authorization: Basic base64(user:password)`, where `password = Base64(HMAC-SHA1(apiKey, Date))`.
- Request `label_code` overrides `bindings.labelCode`; forbid duration uses request `forbid_time_minutes` or `bindings.defaultForbidMinutes`.
- Upstream `code == "0"` returns success or partial success depending on `data.failedIpList`; nonzero codes map to `FAILED_PRECONDITION`.
- HTTP 401/403 maps to `PERMISSION_DENIED`, other 4xx maps to `FAILED_PRECONDITION`, 5xx and network failures map to `UNAVAILABLE`, and empty or non-JSON responses map to `UNKNOWN`.

## Local Checks

```bash
cd services
npm run validate -- --service-dir wangsu__label-ip
npm test -- --service-dir wangsu__label-ip --coverage
npm run pack:check
```
