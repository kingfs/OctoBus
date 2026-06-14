import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  BLOCK_IP_PATH,
  LOGIN_PATH,
  METHOD_BLOCK_IP_FULL,
  METHOD_LOGIN_FULL,
  METHOD_QUERY_BLACKLIST_FULL,
  METHOD_UNBLOCK_IP_FULL,
  QUERY_BLACKLIST_PATH,
  UNBLOCK_IP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/ray-waf-v6-1-2.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    restBaseUrl: 'http://device.example:8443',
    user: 'api_user',
    password: 'SuperSecret',
    headers: { 'X-Custom': 'demo' },
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const response = (status, body, contentType = 'application/json') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => contentType },
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
  Date.now = () => 1710000000000;
  console.log = () => {};
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  console.log = originalConsoleLog;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LOGIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_QUERY_BLACKLIST_FULL], 'function');
  assert.equal(typeof handlers[METHOD_BLOCK_IP_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UNBLOCK_IP_FULL], 'function');
  const routes = rpcdef(buildCtx());
  assert.equal(typeof routes[LOGIN_PATH], 'function');
  assert.equal(typeof routes[QUERY_BLACKLIST_PATH], 'function');
  assert.equal(typeof routes[BLOCK_IP_PATH], 'function');
  assert.equal(typeof routes[UNBLOCK_IP_PATH], 'function');
});

test('Login reads user/password from bindings and returns random', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, {
      adminid: '1',
      pwd_comp: '1',
      pwd_lasttime: '0',
      pwd_len: '10',
      pwd_update_cycle: '30',
      random: 'token-random',
      redirecturl: 'index',
      reminder: '0',
      success: 'true',
      userauth: '1',
    });
  });

  const result = await handlers[METHOD_LOGIN_FULL]({ host: 'http://device.example:8443/' }, buildCtx({ bindings: { skipTlsVerify: true } }));
  assert.equal(captured.url, 'http://device.example:8443/apicenter/login/?username=api_user&password=SuperSecret');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.timeoutMs, 10_000);
  assert.equal(captured.init.skipTlsVerify, true);
  assert.equal(captured.init.headers['X-Custom'], 'demo');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
  assert.equal(result.success, true);
  assert.equal(result.success_raw, 'true');
  assert.equal(result.random, 'token-random');
  assert.equal(result.adminid, '1');
  assert.match(result.raw_json, /token-random/);
});

test('Login validates required host user password and business fields', async () => {
  await expectGrpcError(
    () => handlers[METHOD_LOGIN_FULL]({ user: 'u', password: 'p' }, buildCtx({ bindings: { restBaseUrl: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host\/baseUrl is required/),
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

  setFetch(async () => response(200, { success: 'false', errormessage: 'bad credential' }));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /用户登录失败/);
  });

  setFetch(async () => response(200, { success: true }));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /missing random/);
  });
});

test('QueryBlacklist parses aaData and root fields', async () => {
  setFetch(async (url, init) => {
    assert.equal(String(url), 'http://device.example:8443/apicenter/?action=blacklist_query&username=api_user&random=abc');
    assert.equal(init.method, 'GET');
    return response(200, {
      aaData: [
        [1, '192.168.20.0', '255.255.255.255', 0, 0, '', 0],
        [4, '192.168.20.22', '255.255.255.255', 'bad', 1, 'remark', { x: 9 }],
      ],
      iTotalDisplayRecords: 2,
      iTotalRecords: '2',
      sEcho: '1',
    });
  });

  const result = await rpcdef(buildCtx({ req: { random: 'abc' } }))[QUERY_BLACKLIST_PATH]();
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].id, '1');
  assert.equal(result.records[0].type, 0);
  assert.equal(result.records[1].type, 0);
  assert.equal(result.records[1].direction, 1);
  assert.deepEqual(result.records[1].extra_columns, ['{"x":9}']);
  assert.equal(result.i_total_display_records, 2);
  assert.equal(result.i_total_records, 2);
  assert.equal(result.s_echo, '1');
});

test('QueryBlacklist rejects malformed responses', async () => {
  setFetch(async () => response(200, 'not-json', 'text/plain'));
  await expectGrpcError(() => handlers[METHOD_QUERY_BLACKLIST_FULL]({ random: 'abc' }, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /not valid JSON/);
  });

  setFetch(async () => response(200, {}));
  await expectGrpcError(() => handlers[METHOD_QUERY_BLACKLIST_FULL]({ random: 'abc' }, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /missing aaData/);
  });

  setFetch(async () => response(200, { aaData: [{}] }));
  await expectGrpcError(() => handlers[METHOD_QUERY_BLACKLIST_FULL]({ random: 'abc' }, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /aaData item must be an array/);
  });
});

test('BlockIP validates IPv4 and sends default payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { errormessage: 'add success', id: 6, success: 'true' });
  });

  const result = await handlers[METHOD_BLOCK_IP_FULL]({ random: 'abc', ip: '203.0.113.10' }, buildCtx());
  assert.equal(captured.url, 'http://device.example:8443/apicenter/?action=blacklist_update&username=api_user&random=abc');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.init.body), {
    ids: '0',
    type: '0',
    direction: '0',
    color: '0',
    ip: '203.0.113.10',
    mask: '255.255.255.0',
    remark: '长亭科技万象对接',
    groupid: '0',
    groupid_value: '',
  });
  assert.equal(result.id, '6');
  assert.equal(result.success, true);
});

test('BlockIP supports explicit payload overrides and validates failures', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { errormessage: 'add success', id: 'custom-id', success: 1 });
  });

  const result = await handlers[METHOD_BLOCK_IP_FULL]({
    random: 'abc',
    ip: '203.0.113.11',
    ids: { value: '12' },
    type: '1',
    direction: '1',
    color: '2',
    mask: '255.255.255.255',
    remark: 'manual',
    groupid: '7',
    groupid_value: { nested: true },
  }, buildCtx());
  assert.equal(result.id, 'custom-id');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.ids, '12');
  assert.equal(body.groupid_value, '{"nested":true}');

  await expectGrpcError(
    () => handlers[METHOD_BLOCK_IP_FULL]({ random: 'abc', ip: '2001:db8::1' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /valid IPv4/),
  );
  await expectGrpcError(
    () => handlers[METHOD_BLOCK_IP_FULL]({ random: 'abc' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /ip is required/),
  );

  setFetch(async () => response(200, { success: 'false', errormessage: 'duplicate ip' }));
  await expectGrpcError(() => handlers[METHOD_BLOCK_IP_FULL]({ random: 'abc', ip: '203.0.113.250' }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /duplicate ip/);
  });

  setFetch(async () => response(200, { success: true }));
  await expectGrpcError(() => handlers[METHOD_BLOCK_IP_FULL]({ random: 'abc', ip: '203.0.113.12' }, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /missing id/);
  });
});

test('UnblockIP requires ids and parses success response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { errormessage: 'delete success', success: true });
  });

  const result = await handlers[METHOD_UNBLOCK_IP_FULL]({ random: 'abc', ids: { value: '12' } }, buildCtx());
  assert.equal(captured.url, 'http://device.example:8443/apicenter/?action=blacklist_del&username=api_user&random=abc');
  assert.deepEqual(JSON.parse(captured.init.body), { ids: '12' });
  assert.equal(result.success, true);
  assert.equal(result.errormessage, 'delete success');

  await expectGrpcError(() => handlers[METHOD_UNBLOCK_IP_FULL]({ random: 'abc' }, buildCtx()), 'INVALID_ARGUMENT', (err) => {
    assert.match(err.message, /ids is required/);
  });

  setFetch(async () => response(200, { success: false, errormessage: '' }));
  await expectGrpcError(() => handlers[METHOD_UNBLOCK_IP_FULL]({ random: 'abc', ids: '12' }, buildCtx()), 'FAILED_PRECONDITION', (err) => {
    assert.match(err.message, /解封IP失败/);
  });
});

test('HTTP, empty body, and network errors map to expected codes', async () => {
  for (const [status, code] of [[401, 'PERMISSION_DENIED'], [403, 'PERMISSION_DENIED'], [404, 'FAILED_PRECONDITION'], [503, 'UNAVAILABLE']]) {
    setFetch(async () => response(status, { errormessage: 'failure' }));
    await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), code, (err) => {
      assert.match(err.message, new RegExp(`upstream http ${status}`));
    });
  }

  setFetch(async () => response(200, ''));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNKNOWN', (err) => {
    assert.match(err.message, /response body is empty/);
  });

  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('socket timeout') });
  });
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /socket timeout/);
  });

  setFetch(async () => ({
    status: 500,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ errormessage: 'no ok property' }),
  }));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNAVAILABLE', (err) => {
    assert.match(err.message, /upstream http 500/);
  });
});

test('helper functions cover edge cases', () => {
  assert.equal(_test.normalizeBaseUrl('http://host///'), 'http://host');
  assert.equal(_test.normalizeBaseUrl('ftp://host'), '');
  assert.equal(_test.resolveHost({ base_url: 'http://request' }, { restBaseUrl: 'http://binding' }), 'http://request');
  assert.equal(_test.resolveUser({ username: 'request-user' }, { user: 'binding-user' }), 'binding-user');
  assert.equal(_test.resolvePassword({}, { password: { value: 'secret' } }), 'secret');
  assert.equal(_test.resolveRandom({}, { random: 'r' }), 'r');
  assert.deepEqual(_test.resolveCallContext({ config: { host: 'http://config' }, secret: { password: 'secret' }, bindings: { user: 'u' }, request: { random: 'r' } }).bindings, {
    host: 'http://config',
    password: 'secret',
    user: 'u',
  });
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: '22.8' }, bindings: { timeoutMs: 11 } }), 22);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: -1 }, bindings: { timeoutMs: 11 } }), 11);
  assert.deepEqual(_test.buildTlsOptions({ tlsInsecureSkipVerify: true }), {
    skipTlsVerify: true,
    tlsInsecureSkipVerify: true,
    insecureSkipVerify: true,
  });
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.equal(_test.normalizeSuccess(true), true);
  assert.equal(_test.normalizeSuccess(false), false);
  assert.equal(_test.normalizeSuccess(1), true);
  assert.equal(_test.normalizeSuccess(0), false);
  assert.equal(_test.normalizeSuccess('true'), true);
  assert.equal(_test.normalizeSuccess('false'), false);
  assert.equal(_test.normalizeSuccess(''), false);
  assert.equal(_test.normalizeSuccess('maybe'), null);
  assert.equal(_test.normalizeSuccess({ value: '1' }), true);
  assert.equal(_test.toBoolean({ value: 'on' }), true);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('false'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.toBoolean(Number.NaN), false);
  assert.equal(_test.toInteger('bad', 7), 7);
  const circular = {};
  circular.self = circular;
  assert.match(_test.stringifyJson(circular), /\[object Object\]/);
  assert.equal(_test.stringifyCell({ a: 1 }), '{"a":1}');
  assert.equal(_test.stringifyCell(undefined), '');
  assert.equal(_test.isIPv4('01.2.3.4'), true);
  assert.equal(_test.isIPv4('256.2.3.4'), false);
  assert.equal(_test.buildUrl('http://h/', '/p', { a: '1 2', empty: '' }), 'http://h/p?a=1%202');
  assert.equal(_test.buildUrl('http://h/', '/p'), 'http://h/p');
  assert.throws(() => _test.requireRandom({ req: {}, bindings: {} }), /random is required/);
  assert.throws(() => _test.throwForHttpStatus(400, 'bad'), /FAILED_PRECONDITION/);
});

test('logFlow falls back when details cannot be JSON stringified', () => {
  const calls = [];
  console.log = (...args) => calls.push(args);
  const circular = {};
  circular.self = circular;
  _test.logFlow({ meta: { instance_id: 'inst', request_id: 'req' } }, 'circular', circular);
  assert.equal(calls[0][0], '[RAY_WAF_V612][circular][inst=inst req=req]');
  assert.equal(calls[0][1], circular);
});

test('mock upstream handles login, query, block, and unblock lifecycle', async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({
      bindings: {
        restBaseUrl: server.url,
        user: 'api_user',
        password: 'SuperSecret',
      },
    });

    const login = await handlers[METHOD_LOGIN_FULL]({}, ctx);
    assert.equal(login.random, 'x3ilv79je222bg4zaca57by45gwha212');

    const before = await handlers[METHOD_QUERY_BLACKLIST_FULL]({ random: login.random }, ctx);
    assert.equal(before.records.length, 2);

    const block = await handlers[METHOD_BLOCK_IP_FULL]({ random: login.random, ip: '203.0.113.10' }, ctx);
    assert.equal(block.success, true);
    assert.equal(block.id, '6');

    const after = await handlers[METHOD_QUERY_BLACKLIST_FULL]({ random: login.random }, ctx);
    assert.equal(after.records.length, 3);

    const unblock = await handlers[METHOD_UNBLOCK_IP_FULL]({ random: login.random, ids: block.id }, ctx);
    assert.equal(unblock.success, true);

    const bad = await fetch(`${server.url}/apicenter/?action=blacklist_query`).then((res) => res.json());
    assert.equal(bad.errormessage, 'missing random');

    const denied = await fetch(`${server.url}/apicenter/login/?username=denied&password=x`).then((res) => res.json());
    assert.equal(denied.errormessage, 'permission denied');

    const duplicate = await handlers[METHOD_BLOCK_IP_FULL]({ random: login.random, ip: '203.0.113.250' }, ctx).catch((err) => err);
    assert.ok(duplicate instanceof GrpcError);
    assert.equal(duplicate.legacyCode, 'FAILED_PRECONDITION');
  } finally {
    await server.close();
  }
});
