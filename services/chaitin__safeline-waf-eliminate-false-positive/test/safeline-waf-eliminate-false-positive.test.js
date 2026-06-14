import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  DEFAULT_TIMEOUT_MS,
  LOCAL_METHOD,
  METHOD_ELIMINATE_FALSE_POSITIVE_FULL,
  _test,
  handlers,
  rpcdef,
} from '../src/safeline-waf-eliminate-false-positive.js';
import { service } from '../src/service.js';

const validReq = {
  target: '10.0.0.1:50053',
  method: 'safeline.eliminate.EliminateService/EliminateFalsePositive',
  event_id: 'ev-1',
  is_global: true,
};

const withProxy = () => {
  globalThis.proxy = {
    toGrpc: (cfg) => ({ kind: 'proxy.toGrpc', ...cfg }),
  };
};

const withoutProxy = () => {
  delete globalThis.proxy;
};

const buildCtx = (overrides = {}) => ({
  bindings: overrides.bindings || {},
  config: overrides.config || {},
  secret: overrides.secret || {},
  meta: {},
  limits: { ...(overrides.limits || {}) },
  req: { ...validReq, ...(overrides.req || {}) },
});

test.afterEach(() => {
  withoutProxy();
});

test('rejects missing required fields with gRPC invalid argument errors', () => {
  withProxy();

  assert.throws(() => rpcdef(buildCtx({ req: { target: '' } })), (err) => {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
    assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
    assert.match(err.message, /INVALID_ARGUMENT: target is required/);
    return true;
  });
  assert.throws(() => rpcdef(buildCtx({ req: { method: ' ' } })), /INVALID_ARGUMENT: method is required/);
  assert.throws(() => rpcdef(buildCtx({ req: { event_id: '' } })), /INVALID_ARGUMENT: event_id is required/);
  assert.throws(() => rpcdef(buildCtx({ req: { is_global: 'yes' } })), /INVALID_ARGUMENT: is_global must be a boolean/);
});

test('maps to proxy.toGrpc with normalized method and timeout', () => {
  withProxy();

  const ctx = buildCtx({
    req: { method: 'safeline.eliminate.EliminateService/EliminateFalsePositive' },
    limits: { timeoutMs: 2000 },
  });
  const mapping = rpcdef(ctx);
  const action = mapping[LOCAL_METHOD];

  assert.equal(action.kind, 'proxy.toGrpc');
  assert.equal(action.target, validReq.target);
  assert.equal(action.fullMethod, '/safeline.eliminate.EliminateService/EliminateFalsePositive');
  assert.deepEqual(action.request, { event_id: validReq.event_id, is_global: validReq.is_global });
  assert.equal(action.timeoutMs, 2000);
});

test('preserves a leading slash and falls back to default timeout', () => {
  withProxy();

  const ctx = buildCtx({
    req: { method: '/safeline.eliminate.EliminateService/EliminateFalsePositive' },
    limits: { timeoutMs: -1 },
  });
  const action = rpcdef(ctx)[LOCAL_METHOD];

  assert.equal(action.fullMethod, '/safeline.eliminate.EliminateService/EliminateFalsePositive');
  assert.equal(action.timeoutMs, DEFAULT_TIMEOUT_MS);
});

test('returns validation-mode proxy mapping for empty validation probes', () => {
  withProxy();

  const action = rpcdef({ req: {}, limits: { timeoutMs: 9000 } })[LOCAL_METHOD];
  const defaultCtxAction = rpcdef()[LOCAL_METHOD];

  assert.equal(action.kind, 'proxy.toGrpc');
  assert.equal(action.target, '0.0.0.0:0');
  assert.equal(action.fullMethod, LOCAL_METHOD);
  assert.deepEqual(action.request, { event_id: '', is_global: false });
  assert.equal(action.timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.equal(defaultCtxAction.target, '0.0.0.0:0');
});

test('buildProxyAction supports wrapped values used by SDK generated inputs', () => {
  withProxy();

  const action = _test.buildProxyAction({
    req: {
      target: { value: 'wrapped.example:50053' },
      method: { value: 'wrapped.Service/EliminateFalsePositive' },
      event_id: { value: 'ev-wrapped' },
      is_global: { value: false },
    },
    limits: {
      timeoutMs: { value: 1900 },
    },
  });

  assert.equal(action.target, 'wrapped.example:50053');
  assert.equal(action.fullMethod, '/wrapped.Service/EliminateFalsePositive');
  assert.deepEqual(action.request, { event_id: 'ev-wrapped', is_global: false });
  assert.equal(action.timeoutMs, 1900);
});

test('SDK handler resolves config and binding defaults', () => {
  withProxy();

  const action = handlers[METHOD_ELIMINATE_FALSE_POSITIVE_FULL]({
    config: {
      target: 'config.example:50053',
      method: 'safeline.eliminate.EliminateService/EliminateFalsePositive',
      timeoutMs: 2500,
    },
    req: {
      event_id: 'ev-config',
      is_global: false,
    },
  });

  assert.equal(action.target, 'config.example:50053');
  assert.equal(action.fullMethod, '/safeline.eliminate.EliminateService/EliminateFalsePositive');
  assert.deepEqual(action.request, { event_id: 'ev-config', is_global: false });
  assert.equal(action.timeoutMs, 2500);

  const bindingAction = handlers[METHOD_ELIMINATE_FALSE_POSITIVE_FULL]({
    bindings: {
      upstream_target: 'binding.example:50053',
      upstream_method: '/custom.Service/EliminateFalsePositive',
      timeout_ms: 3200,
    },
    req: {
      event_id: 'ev-binding',
      is_global: true,
    },
  });

  assert.equal(bindingAction.target, 'binding.example:50053');
  assert.equal(bindingAction.fullMethod, '/custom.Service/EliminateFalsePositive');
  assert.deepEqual(bindingAction.request, { event_id: 'ev-binding', is_global: true });
  assert.equal(bindingAction.timeoutMs, 3200);

  const camelAliasAction = handlers[METHOD_ELIMINATE_FALSE_POSITIVE_FULL]({
    config: {
      upstreamTarget: 'alias.example:50053',
      upstreamMethod: 'alias.Service/EliminateFalsePositive',
      timeout_ms: 2800,
    },
    request: {
      event_id: 'ev-alias',
      is_global: false,
    },
  });

  assert.equal(camelAliasAction.target, 'alias.example:50053');
  assert.equal(camelAliasAction.fullMethod, '/alias.Service/EliminateFalsePositive');
  assert.deepEqual(camelAliasAction.request, { event_id: 'ev-alias', is_global: false });
  assert.equal(camelAliasAction.timeoutMs, 2800);
});

test('request values take precedence over configured defaults', () => {
  withProxy();

  const action = handlers[METHOD_ELIMINATE_FALSE_POSITIVE_FULL]({
    config: {
      target: 'config.example:50053',
      method: '/config.Method/Call',
      timeoutMs: 2500,
    },
    req: {
      ...validReq,
      timeout_ms: 4100,
    },
  });

  assert.equal(action.target, validReq.target);
  assert.equal(action.fullMethod, '/safeline.eliminate.EliminateService/EliminateFalsePositive');
  assert.equal(action.timeoutMs, 4100);
});

test('service wrapper exposes the SDK handler map', () => {
  assert.deepEqual(Object.keys(service.handlers), [METHOD_ELIMINATE_FALSE_POSITIVE_FULL]);
  assert.equal(service.handlers[METHOD_ELIMINATE_FALSE_POSITIVE_FULL], handlers[METHOD_ELIMINATE_FALSE_POSITIVE_FULL]);
});

test('throws failed precondition when proxy.toGrpc is unavailable', () => {
  withoutProxy();

  assert.throws(() => rpcdef(buildCtx()), (err) => {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
    assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
    assert.match(err.message, /global proxy\.toGrpc is required/);
    return true;
  });
});

test('helper utilities unwrap SDK values and merge binding sources', () => {
  assert.equal(_test.unwrapValue({ value: 'wrapped' }), 'wrapped');
  assert.equal(_test.unwrapValue('plain'), 'plain');
  assert.equal(_test.normalizeTimeoutMs({ value: 1800 }), 1800);
  assert.equal(_test.normalizeTimeoutMs(null), DEFAULT_TIMEOUT_MS);
  assert.equal(_test.normalizeTimeoutMs(0), DEFAULT_TIMEOUT_MS);
  assert.equal(_test.normalizeTimeoutMs('bad'), DEFAULT_TIMEOUT_MS);
  assert.equal(_test.errorWithCode('UNKNOWN_TEST', 'fallback').code, grpcStatus.UNKNOWN);
  assert.deepEqual(_test.mergedBindings({
    config: { target: 'config' },
    secret: { method: 'secret' },
    bindings: { method: 'binding' },
  }), {
    target: 'config',
    method: 'binding',
  });
  assert.equal(_test.isValidationMode({ req: { event_id: 'ev-1' } }), false);
  assert.equal(_test.isValidationMode({ req: { unrelated: 'value' } }), true);
  withProxy();
  assert.equal(_test.getProxyToGrpc()({ target: 'direct' }).target, 'direct');
  assert.equal(typeof _test.buildProxyAction, 'function');
  assert.deepEqual(_test.resolveCallContext({
    request: { upstream_target: 'request-alias', upstream_method: 'request.Method/Call' },
    limits: { timeoutMs: null },
  }), {
    req: {
      upstream_target: 'request-alias',
      upstream_method: 'request.Method/Call',
      target: 'request-alias',
      method: 'request.Method/Call',
    },
    limits: {
      timeoutMs: null,
    },
  });
  assert.equal(typeof _test.errorWithCode, 'function');
});
