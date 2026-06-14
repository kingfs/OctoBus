import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_BLOCK_FULL,
  METHOD_BLOCK_PATH,
  METHOD_LOGIN_FULL,
  METHOD_LOGIN_PATH,
  METHOD_LOGOUT_FULL,
  METHOD_LOGOUT_PATH,
  METHOD_UNBLOCK_FULL,
  METHOD_UNBLOCK_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/sangfor-fw-v8-0-45.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const buildCtx = (overrides = {}) => ({
  bindings: {
    restBaseUrl: 'https://fw.example.com',
    user: 'api_user',
    password: 'TopSecret',
    headers: { 'X-Trace': 'demo' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const response = (status, body, contentType = 'application/json') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? contentType : '') },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.beforeEach(() => {
  console.log = () => {};
  console.error = () => {};
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LOGIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_BLOCK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNBLOCK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LOGOUT_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_LOGIN_PATH], 'function');
  assert.equal(typeof defs[METHOD_BLOCK_PATH], 'function');
  assert.equal(typeof defs[METHOD_UNBLOCK_PATH], 'function');
  assert.equal(typeof defs[METHOD_LOGOUT_PATH], 'function');
});

test('login returns token and passes configured credentials', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { code: 0, message: 'success', data: { loginResult: { token: 'abc' } } });
  });

  const result = await handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { skipTlsVerify: true } }));
  assert.equal(result.code, 0);
  assert.equal(result.token, 'abc');
  assert.equal(captured.url, 'https://fw.example.com/api/v1/namespaces/public/login');
  assert.deepEqual(captured.body, { name: 'api_user', password: 'TopSecret' });
  assert.equal(captured.init.timeoutMs, 2000);
  assert.equal(captured.init.skipTlsVerify, true);
  assert.equal(captured.init.insecureSkipVerify, true);
  assert.equal(captured.init.headers['X-Trace'], 'demo');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
});

test('login supports request credential overrides and username alias', async () => {
  setFetch(async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { name: 'override', password: 'override-pass' });
    return response(200, { code: 0, data: { loginResult: { token: 'tok' } } });
  });

  const result = await rpcdef(buildCtx({ bindings: { user: '', username: 'api_user' } }))[METHOD_LOGIN_PATH]({
    name: { value: 'override' },
    password: { value: 'override-pass' },
  });
  assert.equal(result.token, 'tok');
});

test('validates required base URL credentials token and addresses', async () => {
  await expectGrpcError(
    () => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { host: '', restBaseUrl: '', baseUrl: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host\/restBaseUrl/),
  );
  await expectGrpcError(
    () => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { user: '', username: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /user is required/),
  );
  await expectGrpcError(
    () => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { password: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /password is required/),
  );
  await expectGrpcError(
    () => handlers[METHOD_BLOCK_FULL]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /token/),
  );
  await expectGrpcError(
    () => handlers[METHOD_BLOCK_FULL]({ token: 'tok', addresses: [] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /non-empty array|at least one IP/),
  );
  await expectGrpcError(
    () => handlers[METHOD_BLOCK_FULL]({ token: 'tok', addresses: [null] }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /elements/),
  );
});

test('block sends payload, accepts code 17, and supports list aliases', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { code: '17', message: 'exists', data: { existed: ['1.1.1.1'] } });
  });

  const result = await handlers[METHOD_BLOCK_FULL](
    { Token: { value: 'tok' }, ip_list: { values: ['1.1.1.1', { value: '2.2.2.2' }, ''] }, description: { value: 'SOC block' } },
    buildCtx(),
  );

  assert.equal(result.code, 17);
  assert.equal(result.message, 'exists');
  assert.equal(captured.url, 'https://fw.example.com/api/batch/v1/namespaces/public/whiteblacklist');
  assert.deepEqual(captured.body, [
    { url: '1.1.1.1', enable: true, type: 'BLACK', description: 'SOC block' },
    { url: '2.2.2.2', enable: true, type: 'BLACK', description: 'SOC block' },
  ]);
  assert.equal(captured.init.headers.Cookie, 'token=tok');
});

test('unblock sends delete payload and accepts code 1004', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { code: 1004, message: 'not found' });
  });

  const result = await handlers[METHOD_UNBLOCK_FULL]({ token: 'tok', targets: ['1.1.1.1'] }, buildCtx());

  assert.equal(result.code, 1004);
  assert.ok(captured.url.endsWith('/whiteblacklist?_method=delete'));
  assert.deepEqual(captured.body, [{ url: '1.1.1.1', type: 'BLACK' }]);
});

test('logout sends empty payload and requires code zero', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, { code: 0, message: 'logout success', data: null });
  });
  const ok = await handlers[METHOD_LOGOUT_FULL]({ token: 'tok' }, buildCtx());
  assert.equal(ok.code, 0);
  assert.equal(captured.url, 'https://fw.example.com/api/v1/namespaces/public/logout');
  assert.deepEqual(captured.body, {});

  setFetch(async () => response(200, { code: 10, message: 'deny' }));
  await expectGrpcError(() => handlers[METHOD_LOGOUT_FULL]({ token: 'tok' }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /logout failed/);
  });
});

test('transport protocol business and network errors map correctly', async () => {
  for (const [status, legacyCode] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [404, 'FAILED_PRECONDITION'], [500, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, `http ${status}`, 'text/plain'));
    await expectGrpcError(
      () => handlers[METHOD_BLOCK_FULL]({ token: 'tok', addresses: ['1.1.1.1'] }, buildCtx()),
      legacyCode,
      (err) => assert.match(err.message, new RegExp(`upstream http ${status}`)),
    );
  }

  setFetch(async () => response(200, '', 'application/json'));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /empty or invalid/);
  });

  setFetch(async () => response(200, 'not-json', 'text/plain'));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /not valid JSON/);
  });

  setFetch(async () => response(200, { code: 5, message: 'bad credentials' }));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'PERMISSION_DENIED', (err) => {
    assert.match(err.message, /login failed: code=5/);
  });

  setFetch(async () => response(200, { code: 0, data: { loginResult: { token: '' } } }));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /token is empty/);
  });

  setFetch(async () => response(200, { code: 99, message: 'blocked' }));
  await expectGrpcError(() => handlers[METHOD_BLOCK_FULL]({ token: 'tok', addresses: ['1.1.1.1'] }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /BlockIP failed/);
  });

  setFetch(async () => response(200, { code: 99, message: 'blocked' }));
  await expectGrpcError(() => handlers[METHOD_UNBLOCK_FULL]({ token: 'tok', addresses: ['1.1.1.1'] }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /UnblockIP failed/);
  });

  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('timeout') });
  });
  await expectGrpcError(() => handlers[METHOD_BLOCK_FULL]({ token: 'tok', addresses: ['1.1.1.1'] }, buildCtx()), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /timeout/);
  });

  setFetch(async () => {
    throw new Error('');
  });
  await expectGrpcError(() => handlers[METHOD_BLOCK_FULL]({ token: 'tok', addresses: ['1.1.1.1'] }, buildCtx()), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /fetch failed/);
  });
});

test('helper functions cover aliases and fallbacks', () => {
  assert.equal(_test.errorWithCode('NOT_A_CODE', 'bad').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.unwrapString({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.unwrapString(null), '');
  assert.equal(_test.pickString(null), undefined);
  assert.equal(_test.pickString({ value: 'picked' }), 'picked');
  assert.equal(_test.normalizeBaseUrl('https://host///'), 'https://host');
  assert.equal(_test.normalizeBaseUrl('ftp://host'), null);
  assert.deepEqual(_test.extractStringList({ values: [' a ', { value: 'b' }] }), ['a', 'b']);
  assert.equal(_test.extractStringList('bad'), undefined);
  assert.deepEqual(_test.ensureAddresses({ ipList: ['1.1.1.1'] }), ['1.1.1.1']);
  assert.deepEqual(_test.ensureAddresses({ targets: ['2.2.2.2'] }), ['2.2.2.2']);
  assert.equal(_test.requireToken({ Token: { value: 'tok' } }), 'tok');
  assert.equal(_test.resolveLoginField('', 'binding', 'user'), 'binding');
  assert.equal(_test.toBoolean({ value: 'yes' }), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean(Number.NaN), false);
  assert.equal(_test.optionalUint32({ value: '10.9' }), 10);
  assert.equal(_test.optionalUint32('bad'), undefined);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: -1 } }, { timeoutMs: '123' }), 123);
  assert.deepEqual(_test.buildEngineHeaders({ headers: { x: '1' } }, { instanceId: 'inst2', requestId: 'req2' }), {
    x: '1',
    'x-engine-instance': 'inst2',
    'x-request-id': 'req2',
  });
  assert.deepEqual(_test.buildBlockPayload(['1.1.1.1'], ''), [{ url: '1.1.1.1', enable: true, type: 'BLACK', description: 'Block IP' }]);
  assert.deepEqual(_test.buildUnblockPayload(['1.1.1.1']), [{ url: '1.1.1.1', type: 'BLACK' }]);
  assert.doesNotThrow(() => _test.ensureSuccessCode(17, new Set([17]), 'BlockIP', 'ok'));
  assert.throws(() => _test.ensureSuccessCode(5, new Set([0]), 'BlockIP', ''), /unknown/);
  assert.equal(_test.parseJson('', 'application/json'), null);
  assert.deepEqual(_test.parseJson('{"ok":true}', 'application/json'), { ok: true });
  assert.equal(_test.mapSangforResponse({ code: '7', message: 8 }).code, 7);
  assert.equal(_test.mapSangforResponse({ code: '7', message: 8 }).message, '8');
  assert.throws(() => _test.requireJsonObject(null, 'Action'), /empty or invalid/);
  assert.equal(_test.ensureBaseUrl({ baseUrl: 'http://host/' }), 'http://host');
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.deepEqual(_test.buildTlsOptions({ tlsInsecureSkipVerify: 'true' }), { insecureSkipVerify: true, tlsInsecureSkipVerify: true, skipTlsVerify: true });
});

test('resolve context merges config secret and bindings', () => {
  const ctx = _test.resolveCallContext({
    config: { host: 'https://config.example.com', timeoutMs: 10 },
    secret: { user: 'secret-user', password: 'secret-password' },
    bindings: { user: 'binding-user' },
    request: { token: 'tok' },
  });
  assert.deepEqual(ctx.bindings, {
    host: 'https://config.example.com',
    timeoutMs: 10,
    user: 'binding-user',
    password: 'secret-password',
  });
  assert.deepEqual(ctx.req, { token: 'tok' });
});

test('logging falls back when JSON stringify fails', () => {
  const logCalls = [];
  const errorCalls = [];
  console.log = (...args) => logCalls.push(args);
  console.error = (...args) => errorCalls.push(args);
  const circular = {};
  circular.self = circular;
  _test.logInfo({ instanceId: 'inst', requestId: 'req' }, 'Info', circular);
  _test.logError({ instance_id: 'inst', request_id: 'req' }, 'Error', circular);
  assert.equal(logCalls[0][0], '[Sangfor_FW_V8045][Info][inst=inst req=req]');
  assert.equal(logCalls[0][1], circular);
  assert.equal(errorCalls[0][0], '[Sangfor_FW_V8045][Error][inst=inst req=req]');
  assert.equal(errorCalls[0][1], circular);
});

test('rpcdef falls back to context request when call request is omitted', async () => {
  setFetch(async () => response(200, { code: 17, message: 'exists' }));
  const result = await rpcdef(buildCtx({ req: { token: 'tok', addresses: ['1.1.1.1'] } }))[METHOD_BLOCK_PATH]();
  assert.equal(result.code, 17);
});

test('mock upstream handles login block unblock and logout lifecycle', async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({
      bindings: {
        restBaseUrl: server.url,
        user: 'api_user',
        password: 'SuperSecret!',
      },
    });

    const login = await handlers[METHOD_LOGIN_FULL]({}, ctx);
    assert.ok(login.token);
    const block = await handlers[METHOD_BLOCK_FULL]({ token: login.token, addresses: ['192.0.2.10'] }, ctx);
    assert.equal(block.code, 0);
    const blockAgain = await handlers[METHOD_BLOCK_FULL]({ token: login.token, addresses: ['192.0.2.10'] }, ctx);
    assert.equal(blockAgain.code, 17);
    const unblock = await handlers[METHOD_UNBLOCK_FULL]({ token: login.token, addresses: ['192.0.2.10'] }, ctx);
    assert.equal(unblock.code, 0);
    const unblockAgain = await handlers[METHOD_UNBLOCK_FULL]({ token: login.token, addresses: ['192.0.2.10'] }, ctx);
    assert.equal(unblockAgain.code, 1004);
    const logout = await handlers[METHOD_LOGOUT_FULL]({ token: login.token }, ctx);
    assert.equal(logout.code, 0);
    assert.equal(server.requests.map((request) => request.stage).join(','), 'login,block,block,unblock,unblock,logout');
  } finally {
    await server.close();
  }
});
