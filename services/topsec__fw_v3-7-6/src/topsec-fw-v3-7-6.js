import crypto from 'node:crypto';
import net from 'node:net';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_LOGIN_PATH = '/TopSec_FW_V376.TopSec_FW_V376/Login';
export const METHOD_ADD_PATH = '/TopSec_FW_V376.TopSec_FW_V376/AddBlacklistIP';
export const METHOD_DELETE_PATH = '/TopSec_FW_V376.TopSec_FW_V376/DeleteBlacklistIP';
export const METHOD_LOGOUT_PATH = '/TopSec_FW_V376.TopSec_FW_V376/Logout';

export const METHOD_LOGIN_FULL = 'TopSec_FW_V376.TopSec_FW_V376/Login';
export const METHOD_ADD_FULL = 'TopSec_FW_V376.TopSec_FW_V376/AddBlacklistIP';
export const METHOD_DELETE_FULL = 'TopSec_FW_V376.TopSec_FW_V376/DeleteBlacklistIP';
export const METHOD_LOGOUT_FULL = 'TopSec_FW_V376.TopSec_FW_V376/Logout';

export const LOGIN_HTTP_PATH = '/home/restLogin/';
export const ADD_HTTP_PATH = '/home/default/blackWhite/whiteIpAdd/';
export const DELETE_HTTP_PATH = '/home/default/blackListSpread/deleteLots/';
export const LOGOUT_HTTP_PATH = '/home/restLogout/';
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MEMO = 'Block IP';
export const ALLOWED_HTTP_STATUSES = new Set([200, 201, 204, 209, 210]);

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return undefined;
};

const pickFirstString = (values) => {
  for (const value of values) {
    const str = pickString(value);
    if (str !== undefined && str.trim()) return str.trim();
  }
  return undefined;
};

const pickBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
};

const pickFirstBoolean = (values) => {
  for (const value of values) {
    const bool = pickBoolean(value);
    if (bool !== undefined) return bool;
  }
  return undefined;
};

const toArray = (value) => {
  const raw = unwrapScalar(value);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.values)) return raw.values;
  return undefined;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const normalizeBaseUrl = (rawHost, allowHttp) => {
  const host = pickFirstString([rawHost]);
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host is required via request or bindings');
  const candidate = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  if (/^http:\/\//i.test(candidate) && !allowHttp) {
    throw errorWithCode('FAILED_PRECONDITION', 'HTTPS is required unless allow_http is explicitly enabled');
  }
  return candidate.replace(/\/+$/, '');
};

const resolveBaseUrl = (req = {}, bindings = {}) => {
  const allowHttp = pickFirstBoolean([req.allow_http, req.allowHttp, bindings.allow_http, bindings.allowHttp, bindings.forceHttp, bindings.allowInsecureHttp]) || false;
  const host = pickFirstString([req.host, bindings.host, bindings.baseUrl, bindings.restBaseUrl]);
  return normalizeBaseUrl(host, allowHttp);
};

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : undefined;
};

const resolveTimeoutMs = (ctx = {}) => optionalUint32(ctx.limits?.timeoutMs)
  ?? optionalUint32(ctx.bindings?.timeoutMs)
  ?? optionalUint32(ctx.bindings?.timeout_ms)
  ?? DEFAULT_TIMEOUT_MS;

const resolveSkipTlsVerify = (req = {}, bindings = {}) => pickFirstBoolean([req.skip_tls_verify, req.skipTlsVerify, bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify]) || false;

const buildEngineHeaders = (bindings = {}, meta = {}) => ({
  ...(bindings.headers || {}),
  'x-engine-instance': pickFirstString([meta.instance_id, meta.instanceId, 'unknown']),
  'x-request-id': pickFirstString([meta.request_id, meta.requestId, 'unknown']),
});

const parseKeyString = (raw) => {
  const value = pickFirstString([raw]);
  if (!value) return undefined;
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/=]+$/.test(value)) return Buffer.from(value, 'base64');
  return Buffer.from(value, 'utf8');
};

const ensureKeyMaterial = (req = {}, bindings = {}, keyFieldNames = [], description) => {
  const candidate = pickFirstString([
    ...keyFieldNames.map((name) => req[name]),
    ...keyFieldNames.map((name) => bindings[name]),
  ]);
  const buffer = parseKeyString(candidate);
  if (!buffer || buffer.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', `${description} is required via request or bindings`);
  }
  return buffer;
};

const ensureAesKey = (req, bindings) => {
  const key = ensureKeyMaterial(req, bindings, ['aes_key', 'aesKey', 'aesKeyHex', 'aesKeyBase64'], 'aes_key');
  if (![16, 24, 32].includes(key.length)) {
    throw errorWithCode('INVALID_ARGUMENT', `aes_key must resolve to 16/24/32 bytes, got ${key.length}`);
  }
  return key;
};

const ensureAesIv = (req, bindings) => {
  const iv = ensureKeyMaterial(req, bindings, ['aes_iv', 'aesIv', 'aesIvHex', 'aesIvBase64'], 'aes_iv');
  if (iv.length !== 16) {
    throw errorWithCode('INVALID_ARGUMENT', `aes_iv must resolve to 16 bytes, got ${iv.length}`);
  }
  return iv;
};

const zeroPadBuffer = (buffer, blockSize = 16) => {
  const remainder = buffer.length % blockSize;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(blockSize - remainder)]);
};

const encryptAesCbcZeroPad = (plaintext, keyBuffer, ivBuffer, encoding = 'hex') => {
  const cipher = crypto.createCipheriv(`aes-${keyBuffer.length * 8}-cbc`, keyBuffer, ivBuffer);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([
    cipher.update(zeroPadBuffer(Buffer.from(String(plaintext ?? ''), 'utf8'))),
    cipher.final(),
  ]);
  return encrypted.toString(encoding);
};

const md5Hex = (text) => crypto.createHash('md5').update(String(text ?? ''), 'utf8').digest('hex');

const buildUrlWithQuery = (base, entries) => {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    params.set(String(key), String(value));
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
};

const gatherCookies = (headers) => {
  if (!headers) return '';
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie().map((item) => String(item).split(';')[0].trim()).filter(Boolean).join('; ');
  }
  if (typeof headers.raw === 'function') {
    const raw = headers.raw();
    if (Array.isArray(raw?.['set-cookie'])) return raw['set-cookie'].map((item) => String(item).split(';')[0].trim()).filter(Boolean).join('; ');
  }
  const single = typeof headers.get === 'function' ? headers.get('set-cookie') : headers['set-cookie'];
  if (!single) return '';
  return String(single).split(/,(?=[^;]+?=)/).map((item) => item.trim().split(';')[0]).filter(Boolean).join('; ');
};

const mapHttpError = (status, bodyText) => {
  if (status === 401 || status === 403) throw errorWithCode('PERMISSION_DENIED', `upstream http ${status}: ${bodyText}`);
  if (status >= 400 && status < 500) throw errorWithCode('FAILED_PRECONDITION', `upstream http ${status}: ${bodyText}`);
  throw errorWithCode('UNAVAILABLE', `upstream http ${status}: ${bodyText}`);
};

const fetchText = async (ctx, url, init = {}, options = {}) => {
  const tlsOptions = options.skipTlsVerify ? { insecureSkipVerify: true, tlsInsecureSkipVerify: true } : {};
  let response;
  try {
    response = await fetch(url, { ...init, timeoutMs: resolveTimeoutMs(ctx), ...tlsOptions });
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', err?.cause?.message || err?.message || 'fetch failed');
  }
  const text = await response.text();
  if (!ALLOWED_HTTP_STATUSES.has(response.status)) mapHttpError(response.status, text);
  return { response, text };
};

const tryParseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const decodeBase64Json = (input) => {
  const trimmed = String(input || '').trim();
  if (!trimmed) return { json: null, raw: null };
  const jsonCandidate = tryParseJson(trimmed);
  if (jsonCandidate !== undefined) return { json: jsonCandidate, raw: trimmed };
  const decode = (payload) => {
    return Buffer.from(String(payload || '').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8');
  };
  if (trimmed.startsWith('?')) {
    const remainder = trimmed.slice(1);
    for (let i = 1; i <= remainder.length; i += 1) {
      const candidateToken = remainder.slice(0, i);
      const decoded = decode(remainder.slice(i));
      const parsed = decoded ? tryParseJson(decoded) : undefined;
      if (parsed !== undefined) return { json: parsed, raw: decoded, rotatedToken: candidateToken };
    }
  }
  const decoded = decode(trimmed);
  const parsed = decoded ? tryParseJson(decoded) : undefined;
  if (parsed !== undefined) return { json: parsed, raw: decoded, rotatedToken: undefined };
  return { json: undefined, raw: trimmed };
};

const parseTopSecPayload = (text) => {
  const { json, raw, rotatedToken } = decodeBase64Json(text);
  if (json === undefined) throw errorWithCode('UNKNOWN', 'response is neither JSON nor base64 encoded JSON');
  return { payload: json, rawText: raw || text, rotatedToken };
};

const ensureLoginSuccess = (payload) => {
  if (!payload || typeof payload !== 'object') throw errorWithCode('UNKNOWN', 'login response is empty or invalid');
  if (!Boolean(payload.result)) {
    throw errorWithCode('PERMISSION_DENIED', pickString(payload.msg) || pickString(payload.message) || 'login failed');
  }
  const data = payload.data || {};
  const tokens = Array.isArray(payload.tokens) ? payload.tokens : Array.isArray(data.tokens) ? data.tokens : [];
  const tokenCandidate = pickFirstString(tokens);
  const secret = pickString(payload.secret || data.secret);
  const userMark = pickString(data.authid || data.user_mark || data.userMark);
  if (!tokenCandidate || !secret || !userMark) {
    throw errorWithCode('UNKNOWN', 'login succeeded but token/secret/user_mark missing');
  }
  return { token: tokenCandidate, secret, userMark, raw: payload };
};

const buildSession = (loginResult, cookie, rotatedToken) => ({
  token: rotatedToken || loginResult.token,
  secret: loginResult.secret,
  user_mark: loginResult.userMark,
  cookie: String(cookie ?? ''),
  vendor_state: loginResult.raw || null,
});

const stringifyCommands = (commands) => JSON.stringify(commands);

const appendCommandFields = (form, commands) => {
  commands.forEach((command, index) => {
    Object.entries(command).forEach(([key, value]) => {
      if (value && typeof value === 'object') {
        Object.entries(value).forEach(([innerKey, innerValue]) => {
          form.append(`commands[${index}][${key}][${innerKey}]`, String(innerValue));
        });
      } else {
        form.append(`commands[${index}][${key}]`, String(value));
      }
    });
  });
  form.append('commands', stringifyCommands(commands));
};

const computeCodeRun = (secret, token, path, commandString) => md5Hex(`${secret}${token}${path}${commandString}`);

const ensureSession = (session) => {
  if (!session || typeof session !== 'object') throw errorWithCode('INVALID_ARGUMENT', 'session is required');
  const token = pickString(session.token);
  const secret = pickString(session.secret);
  const userMark = pickString(session.user_mark || session.userMark);
  const cookie = pickString(session.cookie) || '';
  if (!token || !secret || !userMark) throw errorWithCode('INVALID_ARGUMENT', 'session.token/secret/user_mark must be provided');
  return { token, secret, userMark, cookie, vendor_state: session.vendor_state || session.vendorState || null };
};

const isValidIP = (value) => {
  const str = pickString(value);
  return Boolean(str && net.isIP(str.trim()) !== 0);
};

const ensureIpList = (req = {}) => {
  const list = toArray(req.ip_addresses || req.ipAddresses || req.ips || req.addresses);
  if (!list || list.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'ip_addresses must be a non-empty array');
  return list.map((ip) => {
    const str = pickString(ip);
    if (!str || !isValidIP(str)) throw errorWithCode('INVALID_ARGUMENT', `invalid IP address: ${str || '<empty>'}`);
    return str.trim();
  });
};

const extractPerIpOutcome = (payload) => {
  const data = payload?.data || {};
  const successCandidates = [data.success, data.successList, data.success_ip, data.success_ips, data.successIPs, data.successIpList, data.succeed, data.succeeded];
  const failureCandidates = [data.fail, data.failList, data.failed, data.failedList, data.fail_ips, data.failIPs, data.error, data.errorList];
  const flatten = (candidate) => (toArray(candidate) || []).map((entry) => {
    if (entry && typeof entry === 'object') {
      return {
        ip: pickString(entry.ip || entry.ipaddr || entry.address),
        reason: pickString(entry.reason || entry.message || entry.msg || entry.error) || '',
        code: pickString(entry.code || entry.errcode || entry.errorCode) || '',
      };
    }
    return { ip: pickString(entry), reason: '', code: '' };
  }).filter((item) => item.ip);
  return {
    success: flatten(successCandidates.find((candidate) => toArray(candidate))).map((item) => item.ip),
    failures: flatten(failureCandidates.find((candidate) => toArray(candidate))),
  };
};

const interpretOperationPayload = (payload, ips, action) => {
  if (!payload || typeof payload !== 'object') throw errorWithCode('UNKNOWN', `${action} response is empty or invalid`);
  const result = Boolean(payload.result);
  const message = pickString(payload.msg) || pickString(payload.message) || '';
  const { success, failures } = extractPerIpOutcome(payload);
  const successSet = new Set(success);
  const resolvedSuccess = [];
  let resolvedFailures = [];
  if (success.length === 0 && failures.length === 0) {
    if (result) {
      resolvedSuccess.push(...ips);
    } else {
      const duplicateHint = /已存在|already\s+exist|exists/i;
      const notFoundHint = /不存在|not\s+found|already\s+removed|策略不存在/i;
      const treatAsSuccess = (action === 'AddBlacklistIP' && duplicateHint.test(message)) || (action === 'DeleteBlacklistIP' && notFoundHint.test(message));
      if (treatAsSuccess) resolvedSuccess.push(...ips);
      else resolvedFailures = ips.map((ip) => ({ ip, reason: message || `${action} failed`, code: '' }));
    }
  } else {
    ips.forEach((ip) => {
      if (successSet.has(ip)) resolvedSuccess.push(ip);
      else {
        const failureEntry = failures.find((item) => item.ip === ip) || { reason: message || `${action} failed`, code: '' };
        resolvedFailures.push({ ip, reason: failureEntry.reason || (result ? '' : message) || `${action} failed`, code: failureEntry.code || '' });
      }
    });
    const okHint = action === 'AddBlacklistIP' ? /已存在|already\s+exist|exists/i : /不存在|not\s+found|already\s+removed|策略不存在/i;
    resolvedFailures = resolvedFailures.filter((entry) => {
      if (okHint.test(entry.reason)) {
        resolvedSuccess.push(entry.ip);
        return false;
      }
      return true;
    });
  }
  return { message, succeeded_ips: [...new Set(resolvedSuccess)], failures: resolvedFailures };
};

const runLogin = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const bindings = callCtx.bindings || {};
  const baseUrl = resolveBaseUrl(req, bindings);
  const username = pickFirstString([req.username, req.user, bindings.user, bindings.username]);
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username is required via request or bindings.user');
  const password = pickFirstString([req.password, bindings.password, callCtx.secret?.password]);
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'password is required via request or bindings.password');
  const skipTlsVerify = resolveSkipTlsVerify(req, bindings);
  const aesKey = ensureAesKey(req, bindings);
  const aesIv = ensureAesIv(req, bindings);
  const form = new URLSearchParams();
  form.append('name', username);
  form.append('password', encryptAesCbcZeroPad(password, aesKey, aesIv, 'hex'));
  form.append('ngtosAuth', encryptAesCbcZeroPad(String(password.length), aesKey, aesIv, 'hex'));
  const { response, text } = await fetchText(callCtx, `${baseUrl}${LOGIN_HTTP_PATH}`, {
    method: 'POST',
    headers: { ...buildEngineHeaders(bindings, callCtx.meta), 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }, { skipTlsVerify });
  const { payload, rotatedToken } = parseTopSecPayload(text);
  const loginResult = ensureLoginSuccess(payload);
  return {
    success: true,
    message: pickString(payload.msg) || pickString(payload.message) || 'success',
    session: buildSession(loginResult, gatherCookies(response.headers), rotatedToken),
    raw: loginResult.raw || payload,
  };
};

const runMutation = async (req = {}, ctx = {}, action) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const bindings = callCtx.bindings || {};
  const baseUrl = resolveBaseUrl(req, bindings);
  const skipTlsVerify = resolveSkipTlsVerify(req, bindings);
  const session = ensureSession(req.session);
  const ips = ensureIpList(req);
  const path = action === 'AddBlacklistIP' ? ADD_HTTP_PATH : DELETE_HTTP_PATH;
  const commands = action === 'AddBlacklistIP'
    ? ips.map((ip) => ({ blacklist_cfg_add_ip: { ipaddr: ip, enable: 'yes', direction: 'src', memo: pickFirstString([req.memo, bindings.memo]) || DEFAULT_MEMO } }))
    : [{ if: false }, ...ips.map((ip) => ({ blacklist_cfg_delete_ip: { ipaddr: ip } }))];
  const commandsString = stringifyCommands(commands);
  const codeRun = computeCodeRun(session.secret, session.token, path, commandsString);
  const requestUrl = buildUrlWithQuery(`${baseUrl}${path}`, [['userMark', session.userMark], ['token', session.token], ['codeRun', codeRun]]);
  const form = new URLSearchParams();
  appendCommandFields(form, commands);
  const { text } = await fetchText(callCtx, requestUrl, {
    method: 'POST',
    headers: { ...buildEngineHeaders(bindings, callCtx.meta), 'content-type': 'application/x-www-form-urlencoded', Cookie: session.cookie },
    body: form.toString(),
  }, { skipTlsVerify });
  const { payload, rotatedToken } = parseTopSecPayload(text);
  const interpretation = interpretOperationPayload(payload, ips, action);
  return {
    succeeded_ips: interpretation.succeeded_ips,
    failures: interpretation.failures,
    session: {
      token: rotatedToken || session.token,
      secret: session.secret,
      user_mark: session.userMark,
      cookie: session.cookie,
      vendor_state: payload?.data || session.vendor_state || null,
    },
    raw: payload,
    message: interpretation.message,
  };
};

const runLogout = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext({ ...ctx, req });
  const bindings = callCtx.bindings || {};
  const baseUrl = resolveBaseUrl(req, bindings);
  const skipTlsVerify = resolveSkipTlsVerify(req, bindings);
  const session = ensureSession(req.session);
  const codeRun = computeCodeRun(session.secret, session.token, LOGOUT_HTTP_PATH, '{}');
  const requestUrl = buildUrlWithQuery(`${baseUrl}${LOGOUT_HTTP_PATH}`, [['userMark', session.userMark], ['token', session.token], ['codeRun', codeRun]]);
  const { text } = await fetchText(callCtx, requestUrl, {
    method: 'GET',
    headers: { ...buildEngineHeaders(bindings, callCtx.meta), Cookie: session.cookie },
  }, { skipTlsVerify });
  const { payload } = parseTopSecPayload(text);
  const success = Boolean(payload?.result);
  const message = pickString(payload?.msg) || pickString(payload?.message) || (success ? 'success' : 'logout failed');
  if (!success) throw errorWithCode('FAILED_PRECONDITION', message);
  return { success: true, message, raw: payload };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LOGIN_PATH]: async (req) => runLogin(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_ADD_PATH]: async (req) => runMutation(req ?? callCtx.req ?? {}, callCtx, 'AddBlacklistIP'),
    [METHOD_DELETE_PATH]: async (req) => runMutation(req ?? callCtx.req ?? {}, callCtx, 'DeleteBlacklistIP'),
    [METHOD_LOGOUT_PATH]: async (req) => runLogout(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (req, ctx = {}) => runLogin(req, ctx),
  [METHOD_ADD_FULL]: (req, ctx = {}) => runMutation(req, ctx, 'AddBlacklistIP'),
  [METHOD_DELETE_FULL]: (req, ctx = {}) => runMutation(req, ctx, 'DeleteBlacklistIP'),
  [METHOD_LOGOUT_FULL]: (req, ctx = {}) => runLogout(req, ctx),
};

export const _test = {
  appendCommandFields,
  buildEngineHeaders,
  buildSession,
  buildUrlWithQuery,
  computeCodeRun,
  decodeBase64Json,
  encryptAesCbcZeroPad,
  ensureAesIv,
  ensureAesKey,
  ensureIpList,
  ensureLoginSuccess,
  ensureSession,
  errorWithCode,
  extractPerIpOutcome,
  fetchText,
  gatherCookies,
  grpcCodeFor,
  hasOwn,
  interpretOperationPayload,
  isValidIP,
  mapHttpError,
  md5Hex,
  normalizeBaseUrl,
  parseKeyString,
  parseTopSecPayload,
  pickBoolean,
  pickFirstBoolean,
  pickFirstString,
  pickString,
  resolveBaseUrl,
  resolveCallContext,
  resolveSkipTlsVerify,
  resolveTimeoutMs,
  runLogin,
  runLogout,
  runMutation,
  stringifyCommands,
  toArray,
  tryParseJson,
  unwrapScalar,
  zeroPadBuffer,
};
