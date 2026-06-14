import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  ADD_HTTP_PATH,
  DELETE_HTTP_PATH,
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
} from '../src/topsec-fw-v3-7-6.js';
import { service } from '../src/service.js';
import { AES_IV_HEX, AES_KEY_HEX, PASSWORD, createMockServer, decryptAesZeroPadHex } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const baseBindings = {
  host: 'https://topsec.example.com',
  user: 'admin',
  password: PASSWORD,
  aesKey: AES_KEY_HEX,
  aesIv: AES_IV_HEX,
  memo: 'Block IP',
  headers: { 'x-env': 'test' },
};

const buildCtx = (overrides = {}) => ({
  bindings: { ...baseBindings, ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 5000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
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
  const codes = {
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  };
  assert.equal(caught.code, codes[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  for (const method of [METHOD_LOGIN_FULL, METHOD_ADD_FULL, METHOD_DELETE_FULL, METHOD_LOGOUT_FULL]) {
    assert.equal(typeof handlers[method], 'function');
  }
  const defs = rpcdef(buildCtx());
  for (const path of [METHOD_LOGIN_PATH, METHOD_ADD_PATH, METHOD_DELETE_PATH, METHOD_LOGOUT_PATH]) {
    assert.equal(typeof defs[path], 'function');
  }
});

test('Login encrypts password and returns session with cookies', async () => {
  let captured;
  setFetch(async (url, init) => {
    const form = parseForm(init.body);
    captured = { url: String(url), init, form };
    return responseOf(200, JSON.stringify({
      result: true,
      msg: 'login success',
      secret: 'sec-token',
      tokens: ['token-1'],
      data: { authid: 'mark-1', tokens: ['token-1'], secret: 'sec-token' },
    }), { 'set-cookie': ['session=abc; Path=/; HttpOnly'] });
  });

  const res = await handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { skipTlsVerify: true } }));
  assert.equal(captured.url, 'https://topsec.example.com/home/restLogin/');
  assert.equal(captured.form.name, 'admin');
  assert.equal(decryptAesZeroPadHex(captured.form.password), PASSWORD);
  assert.equal(decryptAesZeroPadHex(captured.form.ngtosAuth), String(PASSWORD.length));
  assert.equal(captured.init.tlsInsecureSkipVerify, true);
  assert.equal(captured.init.headers['x-env'], 'test');
  assert.equal(res.success, true);
  assert.equal(res.session.token, 'token-1');
  assert.equal(res.session.secret, 'sec-token');
  assert.equal(res.session.user_mark, 'mark-1');
  assert.equal(res.session.cookie, 'session=abc');
});

test('AddBlacklistIP signs payload, rotates token and normalizes duplicates', async () => {
  const session = { token: 'tok-initial', secret: 'sec-value', user_mark: 'mark-xyz', cookie: 'session=abc' };
  let captured;
  setFetch(async (url, init) => {
    const parsedUrl = new URL(url);
    const form = parseForm(init.body);
    captured = { parsedUrl, init, commandsString: form.commands };
    const payload = { result: true, msg: 'ok', data: { success_ips: ['1.1.1.1'], fail_ips: [{ ip: '2.2.2.2', reason: 'already exists', code: 'E_DUP' }] } };
    return responseOf(200, `?rotated-token${Buffer.from(JSON.stringify(payload)).toString('base64')}`);
  });

  const res = await handlers[METHOD_ADD_FULL]({ session, ip_addresses: ['1.1.1.1', '2.2.2.2'] }, buildCtx());
  assert.equal(captured.parsedUrl.origin + captured.parsedUrl.pathname, 'https://topsec.example.com/home/default/blackWhite/whiteIpAdd/');
  const expectedCodeRun = crypto.createHash('md5').update(`${session.secret}${session.token}${ADD_HTTP_PATH}${captured.commandsString}`).digest('hex');
  assert.equal(captured.parsedUrl.searchParams.get('codeRun'), expectedCodeRun);
  assert.equal(captured.init.headers.Cookie, 'session=abc');
  assert.equal(res.session.token, 'rotated-token');
  assert.deepEqual(res.succeeded_ips.sort(), ['1.1.1.1', '2.2.2.2']);
  assert.equal(res.failures.length, 0);
});

test('DeleteBlacklistIP treats not found as success', async () => {
  const session = { token: 'tok', secret: 'sec', user_mark: 'mark', cookie: 'session=abc' };
  setFetch(async () => responseOf(200, JSON.stringify({ result: false, msg: 'not found', data: { fail_ips: [{ ip: '3.3.3.3', reason: 'already removed' }] } })));
  const res = await handlers[METHOD_DELETE_FULL]({ session, ip_addresses: ['3.3.3.3'] }, buildCtx());
  assert.deepEqual(res.succeeded_ips, ['3.3.3.3']);
  assert.equal(res.failures.length, 0);
});

test('mock upstream supports login add delete logout flow', async () => {
  const mock = createMockServer();
  const host = await mock.start();
  try {
    const login = await handlers[METHOD_LOGIN_FULL]({ host, allow_http: true }, buildCtx());
    const add = await handlers[METHOD_ADD_FULL]({ session: login.session, ip_addresses: ['198.51.100.10'] }, buildCtx({ bindings: { host, allow_http: true } }));
    assert.deepEqual(add.succeeded_ips, ['198.51.100.10']);
    const addAgain = await handlers[METHOD_ADD_FULL]({ session: add.session, ip_addresses: ['198.51.100.10'] }, buildCtx({ bindings: { host, allow_http: true } }));
    assert.deepEqual(addAgain.succeeded_ips, ['198.51.100.10']);
    const del = await handlers[METHOD_DELETE_FULL]({ session: addAgain.session, ip_addresses: ['198.51.100.10'] }, buildCtx({ bindings: { host, allow_http: true } }));
    assert.deepEqual(del.succeeded_ips, ['198.51.100.10']);
    const delAgain = await handlers[METHOD_DELETE_FULL]({ session: del.session, ip_addresses: ['198.51.100.10'] }, buildCtx({ bindings: { host, allow_http: true } }));
    assert.deepEqual(delAgain.succeeded_ips, ['198.51.100.10']);
    const logout = await handlers[METHOD_LOGOUT_FULL]({ session: delAgain.session }, buildCtx({ bindings: { host, allow_http: true } }));
    assert.equal(logout.success, true);
    const notFound = await fetch(`${host}/missing`);
    assert.equal(notFound.status, 404);
    assert.equal(mock.requests.length, 7);
  } finally {
    await mock.close();
  }
});

test('mock upstream covers rejection paths', async () => {
  const mock = createMockServer({ allowHttp: false });
  const host = await mock.start();
  try {
    const denied = await fetch(`${host}/home/restLogin/`, { method: 'POST', body: '' });
    assert.equal(denied.status, 403);

    const badLogin = await fetch(`${host}/home/restLogin/`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        name: 'admin',
        password: _test.encryptAesCbcZeroPad('wrong', Buffer.from(AES_KEY_HEX, 'hex'), Buffer.from(AES_IV_HEX, 'hex')),
        ngtosAuth: _test.encryptAesCbcZeroPad(String(PASSWORD.length), Buffer.from(AES_KEY_HEX, 'hex'), Buffer.from(AES_IV_HEX, 'hex')),
      }).toString(),
    });
    assert.equal(badLogin.status, 200);
    assert.match(await badLogin.text(), /invalid credentials/);

    const login = await fetch(`${host}/home/restLogin/`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        name: 'admin',
        password: _test.encryptAesCbcZeroPad(PASSWORD, Buffer.from(AES_KEY_HEX, 'hex'), Buffer.from(AES_IV_HEX, 'hex')),
        ngtosAuth: _test.encryptAesCbcZeroPad(String(PASSWORD.length), Buffer.from(AES_KEY_HEX, 'hex'), Buffer.from(AES_IV_HEX, 'hex')),
      }).toString(),
    });
    const loginJson = await login.json();
    const token = loginJson.tokens[0];
    const userMark = loginJson.data.authid;

    const badToken = await fetch(`${host}/home/default/blackWhite/whiteIpAdd/?userMark=${userMark}&token=bad`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: new URLSearchParams({ commands: '[]' }).toString(),
    });
    assert.equal(badToken.status, 403);

    const badMark = await fetch(`${host}/home/default/blackWhite/whiteIpAdd/?userMark=bad&token=${token}`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: new URLSearchParams({ commands: '[]' }).toString(),
    });
    assert.equal(badMark.status, 403);
  } finally {
    await mock.close();
  }
});

test('errors map for logout vendor failure, HTTP status, fetch, invalid payload, and validation', async () => {
  const session = { token: 'tok', secret: 'sec', user_mark: 'mark', cookie: 'session=abc' };
  setFetch(async () => responseOf(200, JSON.stringify({ result: false, msg: 'invalid session' })));
  await expectGrpcError(() => handlers[METHOD_LOGOUT_FULL]({ session }, buildCtx()), 'FAILED_PRECONDITION', (err) => assert.match(err.message, /invalid session/));

  setFetch(async () => responseOf(403, 'forbidden'));
  await expectGrpcError(() => handlers[METHOD_ADD_FULL]({ session, ip_addresses: ['1.1.1.1'] }, buildCtx()), 'PERMISSION_DENIED');

  setFetch(async () => { throw Object.assign(new Error('outer'), { cause: new Error('timeout') }); });
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNAVAILABLE', (err) => assert.match(err.message, /timeout/));

  setFetch(async () => responseOf(200, 'not-json'));
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx()), 'UNKNOWN');

  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { host: 'http://topsec.example.com' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { user: '', username: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { password: '' }, secret: { password: '' } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_LOGIN_FULL]({}, buildCtx({ bindings: { aesKey: '00', aesIv: AES_IV_HEX } })), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_ADD_FULL]({ session, ip_addresses: [] }, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_ADD_FULL]({ session, ip_addresses: ['bad'] }, buildCtx()), 'INVALID_ARGUMENT');
});

test('helper functions cover parsing, crypto, status, and outcome branches', () => {
  assert.equal(_test.grpcCodeFor('missing'), grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn({ value: 'x' }, 'value'), true);
  assert.equal(_test.hasOwn(null, 'value'), false);
  assert.equal(_test.unwrapScalar({ value: { value: 7 } }), 7);
  assert.equal(_test.pickString({ value: 'x' }), 'x');
  assert.equal(_test.pickString(null), undefined);
  assert.equal(_test.pickString(12), '12');
  assert.equal(_test.pickString(true), 'true');
  assert.equal(_test.pickString({ nope: true }), undefined);
  assert.equal(_test.pickFirstString([undefined, ' y ']), 'y');
  assert.equal(_test.pickFirstString([' ', undefined]), undefined);
  assert.equal(_test.pickBoolean({ value: 'on' }), true);
  assert.equal(_test.pickBoolean('n'), false);
  assert.equal(_test.pickBoolean('yes'), true);
  assert.equal(_test.pickBoolean(true), true);
  assert.equal(_test.pickBoolean(0), false);
  assert.equal(_test.pickBoolean('false'), false);
  assert.equal(_test.pickBoolean('0'), false);
  assert.equal(_test.pickBoolean(Number.NaN), undefined);
  assert.equal(_test.pickBoolean('maybe'), undefined);
  assert.equal(_test.pickFirstBoolean(['bad', 1]), true);
  assert.equal(_test.pickFirstBoolean(['bad']), undefined);
  assert.deepEqual(_test.toArray(['a']), ['a']);
  assert.deepEqual(_test.toArray({ values: ['a'] }), ['a']);
  assert.deepEqual(_test.toArray('x'), undefined);
  assert.equal(_test.resolveCallContext({ request: { host: 'h' } }).req.host, 'h');
  assert.equal(_test.normalizeBaseUrl('topsec.example.com/', false), 'https://topsec.example.com');
  assert.equal(_test.resolveBaseUrl({ host: 'http://h', allow_http: true }, {}), 'http://h');
  assert.equal(_test.resolveBaseUrl({ allowHttp: true }, { restBaseUrl: 'http://rest.example' }), 'http://rest.example');
  assert.equal(_test.resolveBaseUrl({}, { host: 'http://h', forceHttp: true }), 'http://h');
  assert.equal(_test.resolveBaseUrl({}, { host: 'http://h', allowInsecureHttp: true }), 'http://h');
  assert.equal(_test.resolveBaseUrl({}, { baseUrl: 'https://base.example' }), 'https://base.example');
  assert.throws(() => _test.normalizeBaseUrl('', false), /INVALID_ARGUMENT/);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ limits: { timeoutMs: 12 } }))), 12);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: '7.9' }, limits: { timeoutMs: 'bad' } }))), 7);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: '', timeout_ms: '34' }, limits: { timeoutMs: -1 } }))), 34);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: '56' }, limits: { timeoutMs: -1 } }))), 56);
  assert.equal(_test.resolveTimeoutMs(_test.resolveCallContext(buildCtx({ bindings: { timeoutMs: '', timeout_ms: '' }, limits: { timeoutMs: -1 } }))), 5000);
  assert.equal(_test.resolveSkipTlsVerify({ skip_tls_verify: true }, {}), true);
  assert.equal(_test.resolveSkipTlsVerify({ skipTlsVerify: 'yes' }, {}), true);
  assert.equal(_test.resolveSkipTlsVerify({}, { skipTlsVerify: '1' }), true);
  assert.equal(_test.resolveSkipTlsVerify({}, { tlsInsecureSkipVerify: 'true' }), true);
  assert.deepEqual(_test.buildEngineHeaders({}, { instanceId: 'inst2', requestId: 'req2' }), { 'x-engine-instance': 'inst2', 'x-request-id': 'req2' });
  assert.deepEqual(_test.buildEngineHeaders({}, {}, {}), { 'x-engine-instance': 'unknown', 'x-request-id': 'unknown' });
  assert.equal(_test.parseKeyString(undefined), undefined);
  assert.equal(_test.parseKeyString('abc').toString('utf8').length > 0, true);
  assert.equal(_test.parseKeyString(Buffer.from('abcdefghijklmnop').toString('base64')).length, 16);
  assert.equal(_test.parseKeyString('plain-text-key').toString('utf8'), 'plain-text-key');
  assert.equal(_test.ensureAesKey({ aes_key: AES_KEY_HEX }, {}).length, 16);
  assert.equal(_test.ensureAesKey({ aesKeyBase64: Buffer.from(AES_KEY_HEX, 'hex').toString('base64') }, {}).length, 16);
  assert.equal(_test.ensureAesIv({ aesIvHex: AES_IV_HEX }, {}).length, 16);
  assert.throws(() => _test.ensureAesKey({}, {}), /INVALID_ARGUMENT/);
  assert.throws(() => _test.ensureAesIv({}, { aesIv: '00' }), /INVALID_ARGUMENT/);
  assert.equal(_test.zeroPadBuffer(Buffer.from('abc')).length, 16);
  assert.equal(_test.zeroPadBuffer(Buffer.alloc(16)).length, 16);
  assert.match(_test.encryptAesCbcZeroPad('abc', Buffer.from(AES_KEY_HEX, 'hex'), Buffer.from(AES_IV_HEX, 'hex'), 'base64'), /^[A-Za-z0-9+/=]+$/);
  assert.equal(_test.md5Hex('abc'), crypto.createHash('md5').update('abc').digest('hex'));
  assert.equal(_test.buildUrlWithQuery('https://h/p', [['a', 'b'], ['c', null]]), 'https://h/p?a=b');
  assert.equal(_test.buildUrlWithQuery('https://h/p', [['a', undefined]]), 'https://h/p');
  assert.equal(_test.gatherCookies({ raw: () => ({ 'set-cookie': ['a=1; Path=/'] }) }), 'a=1');
  assert.equal(_test.gatherCookies({ raw: () => ({}) }), '');
  assert.equal(_test.gatherCookies({ getSetCookie: () => ['b=2; Path=/'] }), 'b=2');
  assert.equal(_test.gatherCookies({ get: () => null }), '');
  assert.equal(_test.gatherCookies({ 'set-cookie': 'c=3; Path=/' }), 'c=3');
  assert.equal(_test.gatherCookies({ get: () => 'a=1; Path=/,b=2; Path=/' }), 'a=1; b=2');
  assert.equal(_test.gatherCookies(null), '');
  assert.throws(() => _test.mapHttpError(401, 'no'), /PERMISSION_DENIED/);
  assert.throws(() => _test.mapHttpError(404, 'no'), /FAILED_PRECONDITION/);
  assert.throws(() => _test.mapHttpError(500, 'no'), /UNAVAILABLE/);
  assert.equal(_test.decodeBase64Json(Buffer.from(JSON.stringify({ ok: true })).toString('base64')).json.ok, true);
  assert.equal(_test.decodeBase64Json(JSON.stringify({ ok: true })).json.ok, true);
  assert.equal(_test.decodeBase64Json('').json, null);
  assert.equal(_test.decodeBase64Json('?bad').json, undefined);
  assert.throws(() => _test.parseTopSecPayload('bad'), /UNKNOWN/);
  assert.throws(() => _test.ensureLoginSuccess(null), /UNKNOWN/);
  assert.throws(() => _test.ensureLoginSuccess({ result: false, msg: 'no' }), /PERMISSION_DENIED/);
  assert.throws(() => _test.ensureLoginSuccess({ result: false, message: 'denied' }), /PERMISSION_DENIED/);
  assert.throws(() => _test.ensureLoginSuccess({ result: true, data: {} }), /UNKNOWN/);
  assert.deepEqual(_test.ensureLoginSuccess({ result: true, data: { tokens: ['dt'], secret: 'ds', user_mark: 'du' } }), {
    token: 'dt',
    secret: 'ds',
    userMark: 'du',
    raw: { result: true, data: { tokens: ['dt'], secret: 'ds', user_mark: 'du' } },
  });
  assert.equal(_test.ensureLoginSuccess({ result: true, tokens: ['t'], secret: 's', data: { userMark: 'u' } }).userMark, 'u');
  assert.equal(_test.buildSession({ token: 't', secret: 's', userMark: 'u', raw: {} }, '', 'r').token, 'r');
  assert.equal(_test.buildSession({ token: 't', secret: 's', userMark: 'u', raw: null }, 'cookie').cookie, 'cookie');
  assert.equal(_test.stringifyCommands([{ a: 1 }]), '[{\"a\":1}]');
  const form = new URLSearchParams();
  _test.appendCommandFields(form, [{ plain: false }]);
  assert.equal(form.get('commands[0][plain]'), 'false');
  assert.throws(() => _test.ensureSession(null), /INVALID_ARGUMENT/);
  assert.throws(() => _test.ensureSession({ token: 't' }), /INVALID_ARGUMENT/);
  assert.deepEqual(_test.ensureSession({ token: 't', secret: 's', userMark: 'u', vendorState: { a: 1 } }).vendor_state, { a: 1 });
  assert.equal(_test.isValidIP('2001:db8::1'), true);
  assert.equal(_test.isValidIP(null), false);
  assert.equal(_test.isValidIP('bad'), false);
  assert.deepEqual(_test.ensureIpList({ ipAddresses: ['4.4.4.4'] }), ['4.4.4.4']);
  assert.deepEqual(_test.ensureIpList({ ips: ['5.5.5.5'] }), ['5.5.5.5']);
  assert.deepEqual(_test.ensureIpList({ addresses: { values: ['1.1.1.1'] } }), ['1.1.1.1']);
  assert.deepEqual(_test.extractPerIpOutcome({ data: { successList: ['1.1.1.1'], failList: [{ ip: '2.2.2.2', reason: 'no', code: 'E' }] } }), {
    success: ['1.1.1.1'],
    failures: [{ ip: '2.2.2.2', reason: 'no', code: 'E' }],
  });
  assert.deepEqual(_test.extractPerIpOutcome({ data: { success: [{ ipaddr: '1.1.1.1' }], error: [{ address: '2.2.2.2', message: 'bad', errcode: 'E2' }] } }), {
    success: ['1.1.1.1'],
    failures: [{ ip: '2.2.2.2', reason: 'bad', code: 'E2' }],
  });
  assert.deepEqual(_test.interpretOperationPayload({ result: true, msg: 'ok' }, ['1.1.1.1'], 'AddBlacklistIP').succeeded_ips, ['1.1.1.1']);
  assert.deepEqual(_test.interpretOperationPayload({ result: false, msg: 'already exists' }, ['1.1.1.1'], 'AddBlacklistIP').succeeded_ips, ['1.1.1.1']);
  assert.deepEqual(_test.interpretOperationPayload({ result: false, message: '策略不存在' }, ['1.1.1.1'], 'DeleteBlacklistIP').succeeded_ips, ['1.1.1.1']);
  assert.equal(_test.interpretOperationPayload({ result: false, msg: 'hard fail' }, ['1.1.1.1'], 'AddBlacklistIP').failures.length, 1);
  assert.equal(_test.interpretOperationPayload({ result: false, msg: 'hard fail' }, ['1.1.1.1'], 'DeleteBlacklistIP').failures.length, 1);
  assert.equal(_test.interpretOperationPayload({ result: false, data: { success_ips: ['1.1.1.1'] } }, ['1.1.1.1', '2.2.2.2'], 'AddBlacklistIP').failures[0].reason, 'AddBlacklistIP failed');
  assert.equal(_test.interpretOperationPayload({ result: true, msg: 'partial', data: { success_ips: ['1.1.1.1'] } }, ['1.1.1.1', '2.2.2.2'], 'DeleteBlacklistIP').failures[0].reason, 'partial');
  assert.equal(_test.interpretOperationPayload({ result: true, data: { fail_ips: [{ ip: '1.1.1.1', reason: 'hard fail' }] } }, ['1.1.1.1'], 'AddBlacklistIP').failures.length, 1);
  assert.deepEqual(_test.interpretOperationPayload({ result: true, data: { fail_ips: [{ ip: '1.1.1.1', reason: 'not found' }] } }, ['1.1.1.1'], 'DeleteBlacklistIP').succeeded_ips, ['1.1.1.1']);
  assert.throws(() => _test.interpretOperationPayload(null, ['1.1.1.1'], 'AddBlacklistIP'), /UNKNOWN/);
});

test('fetchText and runtime handlers cover alias fallbacks', async () => {
  setFetch(async (url, init) => {
    assert.equal(String(url), 'https://topsec.example.com/home/restLogin/');
    assert.equal(init.timeoutMs, 13);
    return responseOf(201, JSON.stringify({
      result: true,
      message: 'ok from message',
      data: { authid: 'mark', secret: 'sec', tokens: ['tok'] },
    }));
  });
  const viaRequestContext = rpcdef(buildCtx({
    bindings: { user: undefined, username: 'fallback-admin', password: undefined, aesKey: undefined, aesIv: undefined },
    secret: { password: PASSWORD, aesKeyHex: AES_KEY_HEX, aesIvBase64: Buffer.from(AES_IV_HEX, 'hex').toString('base64') },
    limits: { timeoutMs: 13 },
    req: { host: 'topsec.example.com' },
  }));
  const login = await viaRequestContext[METHOD_LOGIN_PATH]();
  assert.equal(login.message, 'ok from message');
  assert.equal(login.session.token, 'tok');

  const session = { token: 'tok', secret: 'sec', userMark: 'mark' };
  setFetch(async (url, init) => {
    const parsedUrl = new URL(url);
    const form = parseForm(init.body);
    assert.equal(parsedUrl.pathname, ADD_HTTP_PATH);
    assert.match(form.commands, /Block IP/);
    return responseOf(209, JSON.stringify({ result: true, data: null }));
  });
  const add = await handlers[METHOD_ADD_FULL]({ session, ip_addresses: ['1.1.1.1'], host: 'topsec.example.com' }, buildCtx({ bindings: { memo: '' } }));
  assert.deepEqual(add.succeeded_ips, ['1.1.1.1']);
  assert.equal(add.session.vendor_state, null);

  setFetch(async (url) => {
    const parsedUrl = new URL(url);
    assert.equal(parsedUrl.pathname, DELETE_HTTP_PATH);
    return responseOf(210, JSON.stringify({ result: true, message: 'deleted' }));
  });
  const del = await rpcdef(buildCtx())[METHOD_DELETE_PATH]({ session, ip_addresses: ['1.1.1.1'] });
  assert.equal(del.message, 'deleted');

  setFetch(async () => responseOf(204, JSON.stringify({ result: true })));
  const logout = await handlers[METHOD_LOGOUT_FULL]({ session }, buildCtx());
  assert.equal(logout.message, 'success');
});

test('fetchText reports fallback error messages', async () => {
  setFetch(async () => { throw new Error('direct failure'); });
  await expectGrpcError(() => _test.fetchText(buildCtx(), 'https://topsec.example.com', {}), 'UNAVAILABLE', (err) => assert.match(err.message, /direct failure/));

  setFetch(async () => { throw 'boom'; });
  await expectGrpcError(() => _test.fetchText(buildCtx(), 'https://topsec.example.com', {}), 'UNAVAILABLE', (err) => assert.match(err.message, /fetch failed/));
});
