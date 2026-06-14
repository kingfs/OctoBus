import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_ACTIVATE_FULL,
  METHOD_ACTIVATE_PATH,
  METHOD_ADD_FULL,
  METHOD_ADD_PATH,
  METHOD_DELETE_FULL,
  METHOD_DELETE_PATH,
  METHOD_LOGIN_FULL,
  METHOD_LOGIN_PATH,
  METHOD_LOGOUT_FULL,
  METHOD_LOGOUT_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/topsec-fw-2u.js';
import { service } from '../src/service.js';
import { createMockServer, encodePayload } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: {
    host: 'https://fw.example.com:4443',
    username: 'api_user',
    password: 'TopSecret!',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 3000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst-100', request_id: 'req-100', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const responseOf = (status, body, headers = {}) => ({
  status,
  headers: {
    get(name) {
      return headers[String(name).toLowerCase()] || null;
    },
    getSetCookie() {
      return Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [];
    },
  },
  arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
});

const binaryResponseOf = (status, bytes, headers = {}) => ({
  status,
  headers: {
    get(name) {
      return headers[String(name).toLowerCase()] || null;
    },
    getSetCookie() {
      return Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [];
    },
  },
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
});

const textResponseOf = (status, body) => ({
  status,
  headers: {},
  text: async () => body,
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
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_LOGIN_FULL], 'function');
  assert.equal(typeof handlers[METHOD_ACTIVATE_FULL], 'function');
  assert.equal(typeof handlers[METHOD_ADD_FULL], 'function');
  assert.equal(typeof handlers[METHOD_DELETE_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LOGOUT_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_LOGIN_PATH], 'function');
  assert.equal(typeof defs[METHOD_ACTIVATE_PATH], 'function');
  assert.equal(typeof defs[METHOD_ADD_PATH], 'function');
  assert.equal(typeof defs[METHOD_DELETE_PATH], 'function');
  assert.equal(typeof defs[METHOD_LOGOUT_PATH], 'function');
});

test('Login encrypts plaintext password and returns parsed session', async () => {
  const form = _test.buildLoginForm('api_user', 'TopSecret!');
  const params = new URLSearchParams(form);
  const cipher = params.get('password');
  const expectedCipher = crypto
    .createCipheriv('aes-128-cbc', Buffer.from('ngfwrestapilogin'), Buffer.from('ngfwrestapilogin'));
  expectedCipher.setAutoPadding(false);
  const padded = Buffer.concat([Buffer.from('TopSecret!'), Buffer.alloc(6)]);

  assert.equal(params.get('name'), 'api_user');
  assert.equal(params.get('pwdlen'), String('TopSecret!'.length));
  assert.equal(cipher, Buffer.concat([expectedCipher.update(padded), expectedCipher.final()]).toString('base64'));

  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(
      200,
      encodePayload({ result: true, data: { authid: 'u-1' }, tokens: ['fallback-token'], secret: 'sec-1' }, '1234567890abcdef'),
      { 'set-cookie': ['PHPSESSID=sid-1; Path=/', 'changeVsid=0; Path=/'] },
    );
  });

  const res = await handlers[METHOD_LOGIN_FULL]({ host: 'https://fw.example.com:4443', username: 'api_user', password: 'TopSecret!' }, buildCtx());
  assert.equal(captured.url, 'https://fw.example.com:4443/home/login/addNoCode/');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst-100');
  assert.equal(captured.init.timeoutMs, 3000);
  assert.equal(res.status_code, 200);
  assert.ok(res.raw_body.startsWith('?1234567890abcdef'));
  assert.deepEqual(res.session, {
    token: '1234567890abcdef',
    user_mark: 'u-1',
    cookie: 'PHPSESSID=sid-1; changeVsid=0; think_language=zh-cn',
    secret: 'sec-1',
  });
});

test('rpcdef uses context request and bindings for login defaults', async () => {
  setFetch(async (_url, init) => {
    const params = new URLSearchParams(init.body);
    assert.equal(params.get('name'), 'bound-user');
    assert.equal(params.get('pwdlen'), '10');
    return responseOf(200, JSON.stringify({ data: { authid: 'mark-bound' }, tokens: ['tok-bound'] }), {
      'set-cookie': ['PHPSESSID=sid-bound; Path=/'],
    });
  });

  const defs = rpcdef(buildCtx({
    bindings: { restBaseUrl: 'https://bound.example', username: 'bound-user' },
    secret: { password: 'bound-pass' },
    req: {},
  }));
  const res = await defs[METHOD_LOGIN_PATH]();
  assert.equal(res.session.token, 'tok-bound');
  assert.equal(res.session.user_mark, 'mark-bound');
});

test('ActivatePermission sends empty form and keeps HTTP 500 as OK-style response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(500, 'server busy');
  });

  const res = await handlers[METHOD_ACTIVATE_FULL]({
    host: 'https://fw.example.com:4443',
    session: { token: 'tok-1', user_mark: 'user-1', cookie: 'PHPSESSID=sid-1' },
  }, buildCtx({ bindings: { skipTlsVerify: 'true' } }));

  assert.equal(captured.url, 'https://fw.example.com:4443/home/index/?userMark=user-1');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.body, '');
  assert.equal(captured.init.headers.Cookie, 'PHPSESSID=sid-1');
  assert.equal(captured.init.headers.Referer, 'https://fw.example.com:4443/home/index/?userMark=user-1');
  assert.equal(captured.init.skipTlsVerify, true);
  assert.equal(res.status_code, 500);
  assert.equal(res.raw_body, 'server busy');
});

test('AddBlacklistIP encodes tuple body and returns refreshed token', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, encodePayload({ result: true, data: 'success' }, 'fedcba0987654321'));
  });

  const res = await handlers[METHOD_ADD_FULL]({
    host: 'https://fw.example.com:4443/',
    session: { token: 'tok-old', user_mark: 'user-1', cookie: 'PHPSESSID=sid-1', secret: 'sec-1' },
    ips: ['198.51.100.10', '198.51.100.11'],
  }, buildCtx());

  assert.equal(captured.url, 'https://fw.example.com:4443/home/default/blackListSpread/addTuple/?userMark=user-1');
  const params = new URLSearchParams(captured.init.body);
  assert.equal(params.get('token'), 'tok-old');
  assert.equal(params.get('commands[0][pf_blacklist_add_tuple][0][tuple]'), '198.51.100.10,,,,,;198.51.100.11,,,,,;');
  assert.deepEqual(res.session, {
    token: 'fedcba0987654321',
    user_mark: 'user-1',
    cookie: 'PHPSESSID=sid-1',
    secret: 'sec-1',
  });
});

test('DeleteBlacklistIP supports batched IPs in one request and token body refresh', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, JSON.stringify({ token: 'tok-new', data: { userMark: 'user-new', secret: 'sec-new' } }));
  });

  const res = await handlers[METHOD_DELETE_FULL]({
    host: 'https://fw.example.com:4443',
    session: { token: 'tok-del', user_mark: 'user-2', cookie: 'PHPSESSID=sid-2' },
    ip_addresses: ['198.51.100.10', '2001:db8::1'],
  }, buildCtx());

  assert.equal(captured.url, 'https://fw.example.com:4443/home/default/blackListSpread/deleteLots/?userMark=user-2');
  const params = new URLSearchParams(captured.init.body);
  assert.equal(params.get('commands[0][pf_blacklist_delete][0][sip]'), '198.51.100.10');
  assert.equal(params.get('commands[1][pf_blacklist_delete][0][sip]'), '2001:db8::1');
  assert.equal(params.get('token'), 'tok-del');
  assert.deepEqual(res.session, {
    token: 'tok-new',
    user_mark: 'user-new',
    cookie: 'PHPSESSID=sid-2',
    secret: 'sec-new',
  });
});

test('Logout sends GET and preserves raw body', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, encodePayload({ result: true, data: 'logout success' }));
  });

  const res = await handlers[METHOD_LOGOUT_FULL]({
    host: 'https://fw.example.com:4443',
    session: { token: 'tok-out', user_mark: 'user-3', cookie: 'PHPSESSID=sid-3' },
  }, buildCtx());

  assert.equal(captured.url, 'https://fw.example.com:4443/home/index/logout/?userMark=user-3&token=tok-out');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers.Cookie, 'PHPSESSID=sid-3');
  assert.equal(res.status_code, 200);
  assert.ok(res.raw_body);
});

test('mock upstream supports the main TopSec flow', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const login = await handlers[METHOD_LOGIN_FULL]({ host, username: 'demo', password: 'secret' }, buildCtx());
    assert.equal(login.session.user_mark, 'mark-demo');
    const session = login.session;
    const activate = await handlers[METHOD_ACTIVATE_FULL]({ host, session }, buildCtx());
    assert.equal(activate.status_code, 500);
    const add = await handlers[METHOD_ADD_FULL]({ host, session, ips: ['198.51.100.20'] }, buildCtx());
    assert.equal(add.session.token, 'fedcba0987654321');
    const del = await handlers[METHOD_DELETE_FULL]({ host, session: add.session, ips: ['198.51.100.20'] }, buildCtx());
    assert.equal(del.session.token, 'fedcba0987654321');
    const logout = await handlers[METHOD_LOGOUT_FULL]({ host, session: add.session }, buildCtx());
    assert.equal(logout.status_code, 200);
    assert.equal(mock.requests.length, 5);
  } finally {
    await mock.close();
  }
});

test('mock upstream returns 404 for unknown routes', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const res = await fetch(`${host}/unknown`);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), 'not found');
  } finally {
    await mock.close();
  }
});

test('Network failures and invalid response bodies map to gRPC errors', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('boom'), { cause: new Error('timeout') });
  });
  await expectGrpcError(
    () => handlers[METHOD_ADD_FULL]({ host: 'https://fw.example.com:4443', session: { token: 'tok', user_mark: 'u', cookie: 'c' }, ips: ['198.51.100.10'] }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.match(err.message, /timeout/),
  );

  setFetch(async () => binaryResponseOf(200, [0xc3, 0x28]));
  await expectGrpcError(
    () => handlers[METHOD_LOGIN_FULL]({ host: 'https://fw.example.com:4443', username: 'api_user', password: 'TopSecret!' }, buildCtx()),
    'UNKNOWN',
    (err) => assert.match(err.message, /valid UTF-8/),
  );

  setFetch(async () => ({
    status: 200,
    headers: {},
    text: async () => {
      throw new Error('read failed');
    },
  }));
  await expectGrpcError(
    () => handlers[METHOD_LOGIN_FULL]({ host: 'https://fw.example.com:4443', username: 'api_user', password: 'TopSecret!' }, buildCtx()),
    'UNKNOWN',
  );
});

test('Input validation rejects host session and IP errors', async () => {
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({ host: 'fw.example.com', username: 'u', password: 'p' }, buildCtx()), 'INVALID_ARGUMENT', (err) => {
    assert.match(err.message, /absolute http\/https/);
  });
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({ host: 'https://fw.example.com', username: '', password: 'p' }, buildCtx({ bindings: { username: '', user: '', name: '' } })), 'INVALID_ARGUMENT', (err) => {
    assert.match(err.message, /username is required/);
  });
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({ host: 'https://fw.example.com', username: 'u', password: '' }, buildCtx({ secret: { password: '' }, bindings: { password: '' } })), 'INVALID_ARGUMENT', (err) => {
    assert.match(err.message, /password is required/);
  });
  await expectGrpcError(() => handlers[METHOD_ACTIVATE_FULL]({ host: 'https://fw.example.com' }, buildCtx()), 'INVALID_ARGUMENT', (err) => {
    assert.match(err.message, /session is required/);
  });
  await expectGrpcError(() => handlers[METHOD_ADD_FULL]({ host: 'https://fw.example.com', session: { token: 'tok', user_mark: 'u', cookie: 'c' }, ips: [] }, buildCtx()), 'INVALID_ARGUMENT', (err) => {
    assert.match(err.message, /ips is required/);
  });
  await expectGrpcError(() => handlers[METHOD_ADD_FULL]({ host: 'https://fw.example.com', session: { token: 'tok', user_mark: 'u', cookie: 'c' }, ips: [''] }, buildCtx()), 'INVALID_ARGUMENT', (err) => {
    assert.match(err.message, /blank/);
  });
  await expectGrpcError(() => handlers[METHOD_ADD_FULL]({ host: 'https://fw.example.com', session: { token: 'tok', user_mark: 'u', cookie: 'c' }, ips: ['bad ip'] }, buildCtx()), 'INVALID_ARGUMENT', (err) => {
    assert.match(err.message, /valid IPv4 or IPv6/);
  });
});

test('helper functions cover payload cookie scalar and boolean branches', async () => {
  assert.equal(_test.readString({ value: { value: 'deep' } }), 'deep');
  assert.equal(_test.readString(null), '');
  assert.equal(_test.firstDefined(undefined, null, 'x'), 'x');
  assert.equal(_test.hasOwn({ a: 1 }, 'a'), true);
  assert.deepEqual(_test.unwrapScalar(undefined), undefined);
  assert.deepEqual(_test.unwrapList(['1.1.1.1']), ['1.1.1.1']);
  assert.equal(_test.unwrapList('not-list'), 'not-list');
  assert.equal(_test.unwrapList({ values: [{ value: '1.1.1.1' }] })[0].value, '1.1.1.1');
  assert.equal(_test.isIPv4('192.0.2.1'), true);
  assert.equal(_test.isIPv4('192.0.2'), false);
  assert.equal(_test.isIPv4('192.0.two.1'), false);
  assert.equal(_test.isIPv4('01.0.0.1'), false);
  assert.equal(_test.isIPv4('192.0.2.999'), false);
  assert.equal(_test.isIPv6('::ffff:192.0.2.1'), true);
  assert.equal(_test.isIPv6('::ffff:999.0.2.1'), false);
  assert.equal(_test.isIPv6('2001:db8::1'), true);
  assert.equal(_test.isIPv6('2001::db8::1'), false);
  assert.equal(_test.isIPv6('2001:db8::z'), false);
  assert.equal(_test.isIPv6('not-ip'), false);
  assert.deepEqual(_test.readIpList({ ipList: { values: ['198.51.100.30'] } }), ['198.51.100.30']);
  assert.equal(_test.normalizeCookie('a=1; a=2; think_language=en'), 'a=1; think_language=en');
  assert.equal(_test.gatherCookies({ raw: () => ({ 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] }) }), 'a=1; b=2');
  assert.equal(_test.gatherCookies({ get: () => 'a=1; Path=/,b=2; Path=/' }), 'a=1; b=2');
  assert.equal(_test.gatherCookies(null), '');
  assert.equal(_test.decodeTopSecPayload(Buffer.from(JSON.stringify({ ok: true })).toString('base64')).parsed.ok, true);
  assert.equal(_test.decodeTopSecPayload(`?x${Buffer.from(JSON.stringify({ ok: true })).toString('base64')}`).rotatedToken, 'x');
  assert.equal(_test.decodeTopSecPayload('?bad').parsed, undefined);
  assert.equal(_test.tryParseJson('bad'), undefined);
  assert.equal(_test.tryDecodeBase64Json('bad'), null);
  assert.deepEqual(_test.buildSessionFromLogin({}, {}, ''), null);
  assert.deepEqual(_test.buildSessionFromLogin({ data: { user_mark: 'u' }, tokens: [] }, { getSetCookie: () => ['a=1; Path=/'] }, ''), null);
  assert.deepEqual(_test.buildRefreshedSession({ token: 't', userMark: 'u', cookie: 'c', secret: 's' }, { data: {} }, ''), {
    token: 't',
    user_mark: 'u',
    cookie: 'c',
    secret: 's',
  });
  assert.equal(_test.buildUrl('https://h', '/p/', { a: '1', b: '', c: null }), 'https://h/p/?a=1');
  assert.equal(_test.buildActivateBody(), '');
  assert.deepEqual(_test.buildBaseResponse(204, ''), { status_code: 204, raw_body: '' });
  assert.equal(_test.resolveHost({}, buildCtx({ bindings: { host: '', restBaseUrl: '', baseUrl: 'https://base.example/' } })), 'https://base.example');
  assert.throws(() => _test.resolveHost({}, buildCtx({ bindings: { host: '', restBaseUrl: '', baseUrl: '' } })), /INVALID_ARGUMENT/);
  assert.equal(_test.resolveLoginUsername({ name: 'request-name' }, buildCtx({ bindings: { username: '' } })), 'request-name');
  assert.equal(_test.resolveLoginPassword({}, _test.resolveCallContext({ secret: { password: 'secret-pass' } })), 'secret-pass');
  assert.equal(_test.readTimeoutMs(buildCtx({ req: { timeout_ms: '42' }, limits: { timeoutMs: -1 } })), 42);
  assert.equal(_test.readTimeoutMs(buildCtx({ req: { timeoutMs: 0 }, bindings: { timeout_ms: 'bad' }, limits: { timeoutMs: -1 } })), 5000);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('false'), false);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.toBoolean('maybe'), false);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean(0), false);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(false), false);
  assert.deepEqual(_test.buildTlsOptions(buildCtx({ bindings: { tlsInsecureSkipVerify: true } })), {
    skipTlsVerify: true,
    tlsInsecureSkipVerify: true,
    insecureSkipVerify: true,
  });
  assert.deepEqual(_test.buildTlsOptions(buildCtx()), {});
  assert.equal(_test.refererForUserMark('https://h', 'u 1'), 'https://h/home/index/?userMark=u%201');

  const text = await _test.readResponseBodyText(textResponseOf(200, 'ok'));
  assert.equal(text, 'ok');
  assert.equal(await _test.readResponseBodyText({ status: 200, headers: {} }), '');
  assert.equal(await _test.readResponseBodyText(null), '');
  await expectGrpcError(() => _test.readResponseBodyText({ text: async () => { throw new Error('fail'); } }), 'UNKNOWN');
  assert.equal(_test.base64EncodeBytes(new Uint8Array([1, 2, 3])), 'AQID');
  assert.deepEqual(Array.from(_test.base64DecodeToBytes('AQID')), [1, 2, 3]);
  setFetch(async () => {
    throw new Error('fetch failed');
  });
  await expectGrpcError(() => _test.fetchText(buildCtx(), 'https://fw.example.com', {}), 'UNAVAILABLE');
});
