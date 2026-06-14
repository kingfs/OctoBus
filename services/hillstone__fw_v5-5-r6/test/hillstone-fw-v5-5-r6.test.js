import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  CREATE_ADDR_GROUP_PATH,
  LOGIN_PATH,
  METHOD_CREATE_ADDR_GROUP_FULL,
  METHOD_LOGIN_FULL,
  METHOD_QUERY_ADDR_GROUP_FULL,
  METHOD_UPDATE_ADDR_GROUP_FULL,
  QUERY_ADDR_GROUP_PATH,
  UPDATE_ADDR_GROUP_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/hillstone-fw-v5-5-r6.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://device.example:8443',
    username: 'api_user',
    password: 'SuperSecret!',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const okResponse = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'text/plain;charset=UTF-8' },
  text: async () => body,
});

const responseWithStatus = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'text/plain;charset=UTF-8' },
  text: async () => body,
});

const baseCookies = {
  fromrootvsys: 'false',
  role: 'SuperAdmin',
  vsysId: '1',
  token: 'abc123',
  username: 'api_user',
  lang: 'zh_CN',
};

const expectLegacyGrpcError = async (fn, code, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, code);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
  })[code]);
  assert.match(caught.message, new RegExp(`^${code}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('Login rejects missing host, username, and password bindings', async () => {
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ bindings: { host: '' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /host\/baseUrl is required in bindings/),
  );
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ bindings: { username: '' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /username is required in bindings/),
  );
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ bindings: { password: '' } }))[LOGIN_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /password is required in bindings/),
  );
});

test('Login sends correct payload and returns http_status/http_body on success', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({
      success: true,
      result: {
        fromrootvsys: 'false',
        role: 'SuperAdmin',
        vsysId: '1',
        token: 'abc123',
        username: 'api_user',
        lang: 'zh_CN',
      },
    }));
  };

  const result = await rpcdef(buildCtx({ req: { lang: 'en_US' } }))[LOGIN_PATH]();

  assert.equal(captured.url, 'https://device.example:8443/rest/doc/login');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.timeoutMs, 10_000);
  assert.equal(captured.init.headers['Content-Type'], 'text/plain;charset=UTF-8');
  assert.deepEqual(JSON.parse(captured.init.body), {
    userName: 'api_user',
    password: 'SuperSecret!',
    encodeUserName: '0',
    encodePassword: '0',
    lang: 'en_US',
  });
  assert.equal(result.http_status, 200);
  assert.match(result.http_body, /"success":true/);
});

test('Login reads config and secret aliases with default language and timeout fallback', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse('{"success":true}');
  };

  const result = await handlers[METHOD_LOGIN_FULL]({}, {
    bindings: {},
    config: { base_url: 'https://device.example:8443///', user: 'fallback-user', timeout_ms: 0 },
    secret: { password: 'fallback-pass' },
    limits: { timeoutMs: 0 },
    meta: { instance_id: 'inst', request_id: 'req' },
  });

  assert.equal(captured.url, 'https://device.example:8443/rest/doc/login');
  assert.equal(captured.init.timeoutMs, 1500);
  assert.equal(JSON.parse(captured.init.body).lang, 'zh_CN');
  assert.equal(JSON.parse(captured.init.body).userName, 'fallback-user');
  assert.equal(JSON.parse(captured.init.body).password, 'fallback-pass');
  assert.equal(result.http_status, 200);
});

test('Login returns FAILED_PRECONDITION on 401 and attaches legacy response', async () => {
  globalThis.fetch = async () => responseWithStatus(401, JSON.stringify({ success: false, message: 'Invalid credentials' }));

  await expectLegacyGrpcError(
    () => rpcdef(buildCtx())[LOGIN_PATH](),
    'FAILED_PRECONDITION',
    (err) => {
      assert.equal(err.response.http_status, 401);
      assert.match(err.response.http_body, /Invalid credentials/);
    },
  );
});

test('Login returns UNAVAILABLE with http_status=0 on network error', async () => {
  globalThis.fetch = async () => {
    const err = new Error('network error');
    err.cause = { message: 'connection refused' };
    throw err;
  };

  await expectLegacyGrpcError(
    () => rpcdef(buildCtx())[LOGIN_PATH](),
    'UNAVAILABLE',
    (err) => {
      assert.equal(err.response.http_status, 0);
      assert.match(err.response.http_body, /connection refused/);
    },
  );
});

test('CreateAddrGroup validates cookies, token, addr_groups, and group names', async () => {
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { addr_groups: [{ name: 'test' }] } }))[CREATE_ADDR_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /cookies is required/),
  );
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { cookies: { role: 'SuperAdmin' }, addr_groups: [{ name: 'test' }] } }))[CREATE_ADDR_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /cookies\.token is required/),
  );
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { cookies: { token: 'abc123' } } }))[CREATE_ADDR_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /addr_groups is required/),
  );
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { cookies: { token: 'abc123' }, addr_groups: [] } }))[CREATE_ADDR_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /addr_groups is required/),
  );
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { cookies: { token: 'abc123' }, addr_groups: [{ ip: [] }] } }))[CREATE_ADDR_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /addr_groups\[\]\.name is required/),
  );
});

test('CreateAddrGroup sends encoded cookies and normalized address groups', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ success: true, total: 1, result: [{ name: 'BLOCK_GROUP_01', ip: [] }] }));
  };

  const result = await rpcdef(buildCtx({
    req: {
      cookies: { ...baseCookies, role: 'Super Admin' },
      addr_groups: [{
        name: 'BLOCK_GROUP_01',
        ip: [
          { ip_addr: '203.0.113.10', netmask: '32', flag: 0 },
          { ip_addr: '203.0.113.11', flag: '2.9' },
        ],
      }],
    },
  }))[CREATE_ADDR_GROUP_PATH]();

  assert.equal(captured.url, 'https://device.example:8443/rest/doc/addrbook');
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.init.headers.Cookie, /token=abc123/);
  assert.match(captured.init.headers.Cookie, /role=Super%20Admin/);
  assert.deepEqual(JSON.parse(captured.init.body), [
    {
      name: 'BLOCK_GROUP_01',
      ip: [
        { ip_addr: '203.0.113.10', netmask: '32', flag: 0 },
        { ip_addr: '203.0.113.11', netmask: '32', flag: 2 },
      ],
    },
  ]);
  assert.equal(result.http_status, 200);
  assert.match(result.http_body, /"success":true/);
});

test('CreateAddrGroup returns FAILED_PRECONDITION on 401', async () => {
  globalThis.fetch = async () => responseWithStatus(401, JSON.stringify({ success: false, message: 'Unauthorized' }));

  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { cookies: { token: 'abc123' }, addr_groups: [{ name: 'test' }] } }))[CREATE_ADDR_GROUP_PATH](),
    'FAILED_PRECONDITION',
    (err) => assert.equal(err.response.http_status, 401),
  );
});

test('UpdateAddrGroup sends PUT and preserves success response', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ success: true, result: [], exception: {} }));
  };

  const result = await rpcdef(buildCtx({
    req: {
      cookies: { token: 'abc123' },
      addr_groups: [{ name: 'BLOCK_GROUP_01', ip: [{ ip_addr: '203.0.113.10', netmask: '32', flag: 0 }] }],
    },
  }))[UPDATE_ADDR_GROUP_PATH]();

  assert.equal(captured.url, 'https://device.example:8443/rest/doc/addrbook');
  assert.equal(captured.init.method, 'PUT');
  assert.equal(result.http_status, 200);
});

test('UpdateAddrGroup returns FAILED_PRECONDITION on 500', async () => {
  globalThis.fetch = async () => responseWithStatus(500, JSON.stringify({ success: false, message: 'Internal error' }));

  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { cookies: { token: 'abc123' }, addr_groups: [{ name: 'test' }] } }))[UPDATE_ADDR_GROUP_PATH](),
    'FAILED_PRECONDITION',
    (err) => assert.equal(err.response.http_status, 500),
  );
});

test('QueryAddrGroup validates name and positive limit', async () => {
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { cookies: { token: 'abc123' }, limit: 100 } }))[QUERY_ADDR_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /name is required/),
  );
  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { cookies: { token: 'abc123' }, name: 'test', limit: 0 } }))[QUERY_ADDR_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /limit must be positive/),
  );
});

test('QueryAddrGroup sends GET with legacy query JSON', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({
      success: true,
      result: [{ name: 'BLOCK_GROUP_01', ip: [{ ip_addr: '203.0.113.10', netmask: '32', flag: 0 }] }],
    }));
  };

  const result = await handlers[METHOD_QUERY_ADDR_GROUP_FULL]({
    cookies: { token: 'abc123' },
    name: 'BLOCK_GROUP_01',
    limit: 50,
  }, buildCtx());

  assert.equal(captured.init.method, 'GET');
  assert.match(captured.url, /\/rest\/doc\/addrbook\?query=/);
  const url = new URL(captured.url);
  const query = JSON.parse(decodeURIComponent(url.searchParams.get('query')));
  assert.deepEqual(query.conditions[0], { field: 'name', value: 'BLOCK_GROUP_01' });
  assert.equal(query.start, 0);
  assert.equal(query.limit, 50);
  assert.equal(query.page, 1);
  assert.equal(result.http_status, 200);
});

test('QueryAddrGroup returns UNAVAILABLE on network failure', async () => {
  globalThis.fetch = async () => {
    const err = new Error('timeout');
    err.cause = { message: 'request timeout' };
    throw err;
  };

  await expectLegacyGrpcError(
    () => rpcdef(buildCtx({ req: { cookies: { token: 'abc123' }, name: 'test' } }))[QUERY_ADDR_GROUP_PATH](),
    'UNAVAILABLE',
    (err) => {
      assert.equal(err.response.http_status, 0);
      assert.match(err.response.http_body, /request timeout/);
    },
  );
});

test('TLS flags, exported helpers, service wrapper, and method map are wired', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ success: true }));
  };

  await handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { skipTlsVerify: true } }));

  assert.equal(captured.init.skipTlsVerify, true);
  assert.equal(captured.init.tlsInsecureSkipVerify, true);
  assert.equal(captured.init.insecureSkipVerify, true);
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_CREATE_ADDR_GROUP_FULL], 'function');
  assert.equal(typeof handlers[METHOD_UPDATE_ADDR_GROUP_FULL], 'function');
  assert.equal(typeof handlers[METHOD_QUERY_ADDR_GROUP_FULL], 'function');
  assert.equal(_test.resolveHost({ endpoint: 'https://device.example:8443/' }), 'https://device.example:8443');
  assert.equal(_test.resolveHost({ restBaseUrl: 'https://device.example:8443/' }), 'https://device.example:8443');
  assert.equal(_test.resolveHost({ rest_base_url: 'https://device.example:8443/' }), 'https://device.example:8443');
  assert.equal(_test.resolveHost({ baseUrl: 'https://device.example:8443/' }), 'https://device.example:8443');
  assert.equal(_test.resolveHost({ host: 'device.example:8443' }), '');
  assert.equal(_test.resolveUsername({ userName: { value: 'alice' } }), 'alice');
  assert.equal(_test.resolveUsername({ username: null, userName: null, user: 'bob' }), 'bob');
  assert.equal(_test.resolvePassword({ password: 'secret' }), 'secret');
  assert.equal(_test.resolvePassword({}), '');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 25 } }), 25);
  assert.equal(_test.resolveTimeoutMs({ limits: {}, bindings: { timeout_ms: 30 } }), 30);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.deepEqual(_test.buildHeaders({ bindings: { headers: { 'X-Test': 'yes' } } }, { Cookie: 'token=abc' }), {
    'X-Test': 'yes',
    'Content-Type': 'text/plain;charset=UTF-8',
    Cookie: 'token=abc',
  });
  assert.equal(_test.toInteger('x', 7), 7);
  assert.equal(_test.toInteger(null, 7), 7);
  assert.equal(_test.toInteger(Number.NaN, 7), 7);
  assert.equal(_test.buildCookieHeader('bad'), '');
  assert.equal(_test.buildCookieHeader(null), '');
  assert.equal(_test.buildCookieHeader({ fromrootvsys: '', role: null, vsysId: undefined, token: 'a b' }), 'token=a%20b');
  assert.deepEqual(_test.buildLoginPayload('u', 'p', ''), {
    userName: 'u',
    password: 'p',
    encodeUserName: '0',
    encodePassword: '0',
    lang: 'zh_CN',
  });
  assert.deepEqual(_test.normalizeAddrGroups([{ name: 'G', ip: [{ netmask: '', flag: 'x' }] }]), [
    { name: 'G', ip: [{ ip_addr: '', netmask: '', flag: 0 }] },
  ]);
  assert.deepEqual(_test.normalizeAddrGroups({ values: [{ name: { value: 'Wrapped' }, ip: { values: [] } }] }), [
    { name: 'Wrapped', ip: [] },
  ]);
  assert.equal(_test.normalizeAddrGroups(undefined), null);
  assert.throws(() => _test.throwForStatus(418, 'teapot'), (err) => {
    assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
    assert.equal(err.response.http_status, 418);
    return true;
  });
  assert.ok(new GrpcError(999, 'unknown').code);
});

test('fallback branches handle alternate context shapes and transport defaults', async () => {
  const originalLog = console.log;
  const originalStringify = JSON.stringify;
  try {
    let captured;
    let fetchCount = 0;
    let fallbackLogged = false;
    console.log = (...args) => {
      fallbackLogged ||= args.some((arg) => arg && typeof arg === 'object' && arg.circular === arg);
    };
    JSON.stringify = (value, ...args) => {
      if (value && typeof value === 'object' && value.circular === value) throw new Error('circular');
      return originalStringify(value, ...args);
    };
    globalThis.fetch = async (url, init) => {
      fetchCount += 1;
      captured = { url, init };
      if (fetchCount === 2) throw new Error('plain failure');
      return {
        ok: true,
        status: 204,
        text: async () => '',
      };
    };

    const createResult = await rpcdef({
      bindings: {
        host: 'https://device.example:8443',
        username: 'api_user',
        password: 'SuperSecret!',
      },
      meta: { instanceId: 'inst-alt', requestId: 'req-alt' },
      request: {
        cookies: { token: 'abc123' },
        addr_groups: [{ name: 'Wrapped', ip: [{ ip_addr: null, netmask: null }] }],
      },
    })[CREATE_ADDR_GROUP_PATH]();
    assert.equal(createResult.http_status, 204);
    assert.equal(JSON.parse(captured.init.body)[0].ip[0].netmask, '32');

    await expectLegacyGrpcError(
      () => handlers[METHOD_CREATE_ADDR_GROUP_FULL]({
        cookie: { token: { value: 'abc123' } },
        addr_groups: [{ name: 'test' }],
      }, {
        bindings: {
          host: 'https://device.example:8443',
          username: 'api_user',
          password: 'SuperSecret!',
        },
        meta: {},
      }),
      'UNAVAILABLE',
      (err) => assert.equal(err.response.http_body, 'plain failure'),
    );

    console.log('[HILLSTONE_FW_V55R6][manual]', (() => {
      const circular = {};
      circular.circular = circular;
      return circular;
    })());
    assert.equal(fallbackLogged, true);
  } finally {
    console.log = originalLog;
    JSON.stringify = originalStringify;
  }

  await expectLegacyGrpcError(
    () => rpcdef({
      bindings: {
        host: 'https://device.example:8443',
        username: 'api_user',
        password: 'SuperSecret!',
      },
      req: { cookies: { token: 'abc123' }, addr_groups: [] },
    })[UPDATE_ADDR_GROUP_PATH](),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /addr_groups is required/),
  );

  assert.equal(_test.errorWithCode('NOT_REAL', 'fallback').code, grpcStatus.UNKNOWN);
});
