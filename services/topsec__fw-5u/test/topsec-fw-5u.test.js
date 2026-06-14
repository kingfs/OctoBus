import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_ADD_FULL,
  METHOD_ADD_PATH,
  METHOD_LOGIN_FULL,
  METHOD_LOGIN_PATH,
  METHOD_LOGOUT_FULL,
  METHOD_LOGOUT_PATH,
  METHOD_REFRESH_FULL,
  METHOD_REFRESH_PATH,
  METHOD_REMOVE_FULL,
  METHOD_REMOVE_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/topsec-fw-5u.js';
import { service } from '../src/service.js';
import { createMockServer, decryptQuotedCipher, encodeTokenPayload, PASSWORD } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const baseBindings = {
  host: 'https://topsec5u.example.com:443',
  user: 'admin',
  password: PASSWORD,
  timeoutMs: 5000,
  headers: { 'x-env': 'test' },
};

const buildCtx = (overrides = {}) => ({
  bindings: { ...baseBindings, ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 5000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst-1', request_id: 'req-1', ...(overrides.meta || {}) },
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
  text: async () => String(body),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const parseForm = (body) => Object.fromEntries(new URLSearchParams(String(body || '')).entries());

const parseErrorMessage = (err) => {
  return JSON.parse(err.message);
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
  const expectedCodes = {
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  };
  assert.equal(caught.code, expectedCodes[legacyCode]);
  checker(caught, parseErrorMessage(caught));
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

test('service exports handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  for (const method of [METHOD_LOGIN_FULL, METHOD_REFRESH_FULL, METHOD_ADD_FULL, METHOD_REMOVE_FULL, METHOD_LOGOUT_FULL]) {
    assert.equal(typeof handlers[method], 'function');
  }
  const defs = rpcdef(buildCtx());
  for (const path of [METHOD_LOGIN_PATH, METHOD_REFRESH_PATH, METHOD_ADD_PATH, METHOD_REMOVE_PATH, METHOD_LOGOUT_PATH]) {
    assert.equal(typeof defs[path], 'function');
  }
});

test('Login encrypts password with AES-128-CBC base64 and returns session', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, form: parseForm(init.body) };
    return responseOf(200, encodeTokenPayload('8c7fd52e6dd44b89', {
      result: true,
      data: { authid: '6b3f5c7e98bb4c428d2ac2341775d2f1', message: 'login success' },
    }), { 'set-cookie': ['PHPSESSID=abc; Path=/', 'username=admin; Path=/'] });
  });

  const res = await handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { skipTlsVerify: true } }));
  assert.equal(captured.url, 'https://topsec5u.example.com:443/home/login/');
  assert.equal(captured.form.name, 'admin');
  assert.equal(captured.form.pwdlen, String(PASSWORD.length));
  assert.equal(decryptQuotedCipher(captured.form.password), PASSWORD);
  assert.equal(captured.init.tlsInsecureSkipVerify, true);
  assert.equal(captured.init.headers['x-env'], 'test');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst-1');
  assert.equal(res.success, true);
  assert.equal(res.message, 'login success');
  assert.equal(res.session.token, '8c7fd52e6dd44b89');
  assert.equal(res.session.user_mark, '6b3f5c7e98bb4c428d2ac2341775d2f1');
  assert.equal(res.session.cookie, 'PHPSESSID=abc; username=admin');
  assert.equal(res.http_status, 200);
  assert.equal(res.raw_json.result, true);
});

test('rpcdef uses request overrides and secret password merge', async () => {
  setFetch(async (_url, init) => {
    const form = parseForm(init.body);
    assert.equal(form.name, 'req-user');
    assert.equal(decryptQuotedCipher(form.password), 'secret-pass');
    return responseOf(200, encodeTokenPayload('1111222233334444', {
      result: true,
      data: { authid: 'mark-req' },
    }), { 'set-cookie': ['PHPSESSID=req; Path=/'] });
  });

  const defs = rpcdef(buildCtx({
    bindings: { host: 'http://mock.example:8080', user: '', password: '' },
    secret: { password: 'secret-pass' },
    req: { username: 'req-user', allow_http: true },
  }));
  const res = await defs[METHOD_LOGIN_PATH]();
  assert.equal(res.session.host, 'http://mock.example:8080');
  assert.equal(res.session.allow_http, true);
  assert.equal(res.session.token, '1111222233334444');
});

test('Refresh rotates token and returns updated session', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, encodeTokenPayload('1c2ad06f5e634bc7', {
      result: true,
      data: { message: 'refresh success' },
    }));
  });

  const res = await handlers[METHOD_REFRESH_FULL]({
    session: {
      host: baseBindings.host,
      token: 'old-old-old-old1',
      user_mark: 'mark-1',
      cookie: 'PHPSESSID=abc',
      skip_tls_verify: true,
    },
  }, buildCtx());
  assert.equal(captured.url, 'https://topsec5u.example.com:443/home/index/?userMark=mark-1');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Cookie, 'PHPSESSID=abc');
  assert.equal(res.success, true);
  assert.equal(res.session.token, '1c2ad06f5e634bc7');
  assert.equal(res.session.user_mark, 'mark-1');
});

test('AddToBlacklist and RemoveFromBlacklist handle idempotent outcomes', async () => {
  setFetch(async (_url, init) => {
    const body = parseForm(init.body);
    assert.equal(body['commands[0][pf_blacklist_add_tuple][0][tuple]'], '203.0.113.10,,,,,;');
    assert.equal(body.token, 'toktoktoktoktok1');
    return responseOf(200, encodeTokenPayload('1c2ad06f5e634bc7', { result: false, data: '黑名单条目已存在' }));
  });
  const session = { host: baseBindings.host, token: 'toktoktoktoktok1', user_mark: 'mark-1', cookie: 'PHPSESSID=abc' };
  const add = await handlers[METHOD_ADD_FULL]({ session, ip: '203.0.113.10' }, buildCtx());
  assert.equal(add.success, true);
  assert.equal(add.idempotent_success, true);
  assert.equal(add.session.token, '1c2ad06f5e634bc7');

  setFetch(async (_url, init) => {
    const body = parseForm(init.body);
    assert.equal(body['commands[0][pf_blacklist_delete][0][sip]'], '203.0.113.10');
    return responseOf(200, encodeTokenPayload('cbd734af21ab4c5d', { result: false, data: '黑名单索引不存在' }));
  });
  const remove = await handlers[METHOD_REMOVE_FULL]({ session, ip: '203.0.113.10' }, buildCtx());
  assert.equal(remove.success, true);
  assert.equal(remove.idempotent_success, true);
  assert.equal(remove.session.token, 'cbd734af21ab4c5d');
});

test('Logout succeeds and business failures map to FAILED_PRECONDITION', async () => {
  const session = { host: baseBindings.host, token: 'toktoktoktoktok1', user_mark: 'mark-1', cookie: 'PHPSESSID=abc' };
  setFetch(async (url, init) => {
    assert.equal(String(url), 'https://topsec5u.example.com:443/home/index/logout/?userMark=mark-1&token=toktoktoktoktok1');
    assert.equal(init.method, 'GET');
    return responseOf(200, encodeTokenPayload('cbd734af21ab4c5d', { result: true, data: { message: 'logout success' } }));
  });
  const ok = await handlers[METHOD_LOGOUT_FULL]({ session }, buildCtx());
  assert.equal(ok.success, true);
  assert.equal(ok.message, 'logout success');

  setFetch(async () => responseOf(200, encodeTokenPayload('cbd734af21ab4c5d', { result: false, data: { message: 'invalid session' } })));
  await expectGrpcError(() => handlers[METHOD_LOGOUT_FULL]({ session }, buildCtx()), 'FAILED_PRECONDITION', (_err, parsed) => {
    assert.equal(parsed.http_status, 200);
    assert.equal(parsed.reason, 'invalid session');
  });
});

test('mock upstream supports login refresh add remove logout flow', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const login = await handlers[METHOD_LOGIN_FULL]({ host, username: 'admin', password: PASSWORD, allow_http: true }, buildCtx());
    assert.equal(login.success, true);
    const refresh = await handlers[METHOD_REFRESH_FULL]({ session: login.session }, buildCtx());
    const add = await handlers[METHOD_ADD_FULL]({ session: refresh.session, ip: '198.51.100.10' }, buildCtx());
    assert.equal(add.idempotent_success, false);
    const addAgain = await handlers[METHOD_ADD_FULL]({ session: add.session, ip: '198.51.100.10' }, buildCtx());
    assert.equal(addAgain.idempotent_success, true);
    const remove = await handlers[METHOD_REMOVE_FULL]({ session: addAgain.session, ip: '198.51.100.10' }, buildCtx());
    assert.equal(remove.idempotent_success, false);
    const removeAgain = await handlers[METHOD_REMOVE_FULL]({ session: remove.session, ip: '198.51.100.10' }, buildCtx());
    assert.equal(removeAgain.idempotent_success, true);
    const logout = await handlers[METHOD_LOGOUT_FULL]({ session: removeAgain.session }, buildCtx());
    assert.equal(logout.success, true);
    const notFound = await fetch(`${host}/unknown`);
    assert.equal(notFound.status, 404);
    assert.equal(mock.requests.length, 8);
  } finally {
    await mock.close();
  }
});

test('mock upstream covers invalid auth and session denial paths', async () => {
  const mock = createMockServer({ allowHttp: false });
  const host = await mock.start();
  try {
    const denied = await fetch(`${host}/home/login/`, { method: 'POST', body: '' });
    assert.equal(denied.status, 403);

    const badLogin = await fetch(`${host}/home/login/`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'admin', password: _test.encryptPassword('wrong'), pwdlen: String(PASSWORD.length) }).toString(),
    });
    assert.equal(badLogin.status, 200);
    assert.match(await badLogin.text(), /^[?]/);

    const badRefresh = await fetch(`${host}/home/index/?userMark=missing`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https', cookie: 'PHPSESSID=missing' },
    });
    assert.equal(badRefresh.status, 403);

    const badAdd = await fetch(`${host}/home/default/blackListSpread/addTuple/?userMark=missing`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: new URLSearchParams({ token: 'missing' }).toString(),
    });
    assert.equal(badAdd.status, 403);

    const badRemove = await fetch(`${host}/home/default/blackListSpread/deleteLots/?userMark=missing`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: new URLSearchParams({ token: 'missing' }).toString(),
    });
    assert.equal(badRemove.status, 403);

    const badLogout = await fetch(`${host}/home/index/logout/?userMark=missing&token=missing`, {
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.equal(badLogout.status, 200);
    assert.match(await badLogout.text(), /invalid session|[?]/);
  } finally {
    await mock.close();
  }
});

test('mock upstream covers empty IP business responses', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const login = await handlers[METHOD_LOGIN_FULL]({ host, username: 'admin', password: PASSWORD, allow_http: true }, buildCtx());
    const addEmpty = await fetch(`${host}/home/default/blackListSpread/addTuple/?userMark=${login.session.user_mark}`, {
      method: 'POST',
      body: new URLSearchParams({
        token: login.session.token,
        'commands[0][pf_blacklist_add_tuple][0][tuple]': '',
      }).toString(),
    });
    assert.equal(addEmpty.status, 200);
    const addEmptyBody = await addEmpty.text();
    assert.match(addEmptyBody, /^[?]/);

    const token = String(addEmptyBody).slice(1, 17);
    const removeEmpty = await fetch(`${host}/home/default/blackListSpread/deleteLots/?userMark=${login.session.user_mark}`, {
      method: 'POST',
      body: new URLSearchParams({
        token,
        'commands[0][pf_blacklist_delete][0][sip]': '',
      }).toString(),
    });
    assert.equal(removeEmpty.status, 200);
    assert.match(await removeEmpty.text(), /^[?]/);
  } finally {
    await mock.close();
  }
});

test('HTTP, network, read, payload, and business errors map to legacy JSON gRPC errors', async () => {
  const session = { host: baseBindings.host, token: 'toktoktoktoktok1', user_mark: 'mark-1', cookie: 'PHPSESSID=abc' };
  setFetch(async () => responseOf(403, 'permission denied'));
  await expectGrpcError(() => handlers[METHOD_REFRESH_FULL]({ session }, buildCtx()), 'PERMISSION_DENIED', (_err, parsed) => {
    assert.equal(parsed.http_status, 403);
    assert.equal(parsed.raw_body, 'permission denied');
  });

  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('socket hang up') });
  });
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNAVAILABLE', (_err, parsed) => {
    assert.equal(parsed.http_status, 0);
    assert.equal(parsed.reason, 'socket hang up');
  });

  setFetch(async () => ({ status: 200, headers: {}, text: async () => { throw new Error('read fail'); } }));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNKNOWN', (_err, parsed) => {
    assert.equal(parsed.reason, 'read fail');
  });

  setFetch(async () => responseOf(200, 'not-topsec-payload'));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNKNOWN', (_err, parsed) => {
    assert.equal(parsed.http_status, 200);
  });

  setFetch(async () => responseOf(200, encodeTokenPayload('1111222233334444', { result: false, data: { message: 'invalid credentials' } })));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'PERMISSION_DENIED', (_err, parsed) => {
    assert.equal(parsed.reason, 'invalid credentials');
  });

  setFetch(async () => responseOf(200, encodeTokenPayload('1111222233334444', { result: false, data: { message: 'refresh denied' } })));
  await expectGrpcError(() => handlers[METHOD_REFRESH_FULL]({ session }, buildCtx()), 'FAILED_PRECONDITION', (_err, parsed) => {
    assert.equal(parsed.reason, 'refresh denied');
  });

  setFetch(async () => responseOf(200, encodeTokenPayload('1111222233334444', { result: false, data: { message: 'operation denied' } })));
  await expectGrpcError(() => handlers[METHOD_ADD_FULL]({ session, ip: '198.51.100.10' }, buildCtx()), 'FAILED_PRECONDITION', (_err, parsed) => {
    assert.equal(parsed.reason, 'operation denied');
  });
});

test('input validation rejects invalid sessions, hosts, credentials, and IPs', async () => {
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { host: '' } })), 'INVALID_ARGUMENT', (_err, parsed) => {
    assert.equal(parsed.message, 'host is required');
  });
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({ host: 'http://fw.example.com:80' }, buildCtx()), 'FAILED_PRECONDITION');
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({ host: 'https://fw.example.com:443/path' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({ host: 'https://fw.example.com' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({ username: '' }, buildCtx({ bindings: { user: '', username: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({ password: '' }, buildCtx({ bindings: { password: '' }, secret: { password: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_REFRESH_FULL]({}, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_REFRESH_FULL]({ session: { host: baseBindings.host, token: '', user_mark: 'u', cookie: 'c' } }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_ADD_FULL]({ session: { host: baseBindings.host, token: 't', user_mark: 'u', cookie: 'c' }, ip: '' }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_ADD_FULL]({ session: { host: baseBindings.host, token: 't', user_mark: 'u', cookie: 'c' }, ip: 'bad ip' }, buildCtx()), 'INVALID_ARGUMENT');
});

test('helper functions cover parsing, cookies, status, crypto, and boolean branches', () => {
  assert.equal(_test.pickString(undefined, { value: ' demo ' }), 'demo');
  assert.equal(_test.pickString(1, null), '');
  assert.equal(_test.pickBoolean('yes'), true);
  assert.equal(_test.pickBoolean('true'), true);
  assert.equal(_test.pickBoolean(true), true);
  assert.equal(_test.pickBoolean(false), false);
  assert.equal(_test.pickBoolean('off'), false);
  assert.equal(_test.pickBoolean('maybe'), undefined);
  assert.equal(_test.pickBoolean(undefined), undefined);
  assert.equal(_test.isObject({}), true);
  assert.equal(_test.isObject([]), false);
  assert.equal(_test.hasOwn({ a: 1 }, 'a'), true);
  assert.deepEqual(_test.unwrapScalar(undefined), undefined);
  assert.equal(_test.tryParseJson('{bad'), undefined);
  assert.equal(_test.base64Decode(_test.base64Encode(Buffer.from('abc'))), 'abc');
  assert.equal(_test.decodeTopSecBody(JSON.stringify({ result: true })).decoded.result, true);
  assert.equal(_test.decodeTopSecBody('').decoded, undefined);
  assert.equal(_test.decodeTopSecBody(Buffer.from(JSON.stringify({ result: true })).toString('base64')).decoded.result, true);
  assert.equal(_test.decodeTopSecBody('?bad').decoded, undefined);
  assert.equal(_test.extractTokenFromDecoded({ data: { tokens: ['tok'] } }), 'tok');
  assert.equal(_test.extractTokenFromDecoded({ token: 'top' }), 'top');
  assert.equal(_test.extractTokenFromDecoded({ data: { token: 'nested-token' } }), 'nested-token');
  assert.equal(_test.extractTokenFromDecoded({ tokens: ['list-token'] }), 'list-token');
  assert.equal(_test.extractTokenFromDecoded(null), '');
  assert.equal(_test.resolveDecodedMessage({ data: { msg: 'nested' } }), 'nested');
  assert.equal(_test.resolveDecodedMessage({ data: { message: 'nested message' } }), 'nested message');
  assert.equal(_test.resolveDecodedMessage({ message: 'root' }), 'root');
  assert.equal(_test.resolveDecodedMessage(null), '');
  assert.equal(_test.resolveDecodedMessage({ data: 'plain' }), 'plain');
  assert.equal(_test.normalizeBaseUrl('fw.example.com:443', false), 'https://fw.example.com:443');
  assert.equal(_test.normalizeBaseUrl('http://fw.example.com:80', true), 'http://fw.example.com:80');
  assert.equal(_test.normalizeBaseUrl('https://[2001:db8::1]:443', false), 'https://[2001:db8::1]:443');
  assert.throws(() => _test.normalizeBaseUrl('ftp://fw.example.com:21', true), /host must not include path|host must include explicit port|Invalid URL/);
  assert.equal(_test.isValidIP('2001:db8::1'), true);
  assert.equal(_test.isValidIP('bad'), false);
  assert.equal(_test.resolveTimeoutMs(buildCtx({ limits: { timeoutMs: '12' } })), 12);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: '56' }, limits: { timeoutMs: -1 } }))), 56);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: '', timeout_ms: '34' }, limits: { timeoutMs: -1 } }))), 34);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: '', timeout_ms: '' }, limits: { timeoutMs: -1 } }))), 5000);
  assert.deepEqual(_test.buildEngineHeaders({ headers: { a: 'b' } }, {}, { requestId: 'req' }), {
    a: 'b',
    'x-engine-instance': 'unknown',
    'x-request-id': 'req',
  });
  assert.equal(_test.gatherCookies({ raw: () => ({ 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] }) }), 'a=1; b=2');
  assert.equal(_test.gatherCookies({ raw: () => ({}) }), '');
  assert.equal(_test.gatherCookies({ getSetCookie: () => ['c=3; Path=/'] }), 'c=3');
  assert.equal(_test.gatherCookies({ get: () => null }), '');
  assert.equal(_test.gatherCookies({ get: () => 'a=1; Path=/,b=2; Path=/' }), 'a=1; b=2');
  assert.equal(_test.gatherCookies(null), '');
  assert.equal(_test.mapHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(404), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToCode(500), 'UNAVAILABLE');
  assert.deepEqual(_test.buildSessionContext({ host: 'h', token: 't', user_mark: 'u', cookie: 'c' }, { token: 't2' }).token, 't2');
  assert.deepEqual(_test.buildSessionContext({ host: 'h', token: 't', user_mark: 'u', cookie: 'c', vendor_state: { old: true } }, {}).vendor_state, { old: true });
  assert.deepEqual(_test.ensureSession({ host: 'http://fw.example.com:80', token: 't', userMark: 'u', cookie: 'c', allowHttp: true, skipTlsVerify: true }).allow_http, true);
  assert.throws(() => _test.requireIp('bad'), /INVALID_ARGUMENT/);
  assert.throws(() => _test.parseSuccessfulPayload(200, ''), /UNKNOWN/);
  assert.throws(() => _test.interpretLogin(200, '{}', { result: true, data: {} }, '', { host: 'h', token: '', user_mark: '', cookie: '' }), /UNKNOWN/);
  assert.equal(_test.interpretLogin(200, '{}', { result: true, data: { authid: 'u' }, tokens: ['tok'] }, '', { host: 'h', token: '', user_mark: '', cookie: 'c' }).session.token, 'tok');
  assert.equal(_test.interpretRefresh(200, '{}', { result: true, data: { token: 'tok2' } }, '', { host: 'h', token: 'old', user_mark: 'u', cookie: 'c' }).session.token, 'tok2');
  assert.equal(_test.interpretOperation(200, '{}', { result: true, data: { token: 'tok3' } }, '', { host: 'h', token: 'old', user_mark: 'u', cookie: 'c' }, '198.51.100.10', 'add').session.token, 'tok3');
  assert.equal(_test.zeroPadBuffer(Buffer.from('abc'), 16).length, 16);
  assert.equal(_test.zeroPadBuffer(Buffer.alloc(16), 16).length, 16);

  const cipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from('1111111111111111'), Buffer.from('1111111111111111'));
  cipher.setAutoPadding(false);
  const encrypted = _test.encryptPassword('secret').replace(/^'/, '').replace(/'$/, '');
  assert.equal(Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64')), cipher.final()]).toString('utf8').replace(/\u0000+$/g, ''), 'secret');
});
