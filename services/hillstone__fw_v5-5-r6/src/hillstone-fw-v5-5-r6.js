import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const LOGIN_PATH = '/HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/Login';
export const CREATE_ADDR_GROUP_PATH = '/HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/CreateAddrGroup';
export const UPDATE_ADDR_GROUP_PATH = '/HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/UpdateAddrGroup';
export const QUERY_ADDR_GROUP_PATH = '/HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/QueryAddrGroup';

export const METHOD_LOGIN_FULL = 'HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/Login';
export const METHOD_CREATE_ADDR_GROUP_FULL = 'HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/CreateAddrGroup';
export const METHOD_UPDATE_ADDR_GROUP_FULL = 'HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/UpdateAddrGroup';
export const METHOD_QUERY_ADDR_GROUP_FULL = 'HILLSTONE_FW_V55R6.HILLSTONE_FW_V55R6/QueryAddrGroup';

export const CONTENT_TYPE = 'text/plain;charset=UTF-8';
export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_LANG = 'zh_CN';
export const DEFAULT_LIMIT = 100;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickFirst = (source, keys) => {
  for (const key of keys) {
    if (hasOwn(source, key)) return unwrapScalar(source[key]);
  }
  return undefined;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const toInteger = (value, fallback = 0) => {
  const raw = unwrapScalar(value);
  const num = Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const normalizeBaseUrl = (value) => {
  const raw = toTrimmedString(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const resolveHost = (bindings) => normalizeBaseUrl(firstDefined(
  pickFirst(bindings, ['host']),
  pickFirst(bindings, ['restBaseUrl']),
  pickFirst(bindings, ['rest_base_url']),
  pickFirst(bindings, ['baseUrl']),
  pickFirst(bindings, ['base_url']),
  pickFirst(bindings, ['endpoint']),
));

const resolveUsername = (bindings) => toTrimmedString(firstDefined(
  pickFirst(bindings, ['username']),
  pickFirst(bindings, ['userName']),
  pickFirst(bindings, ['user']),
));

const resolvePassword = (bindings) => toTrimmedString(pickFirst(bindings, ['password']));

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const raw = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const buildTlsOptions = (bindings) => {
  const enabled = Boolean(bindings?.skipTlsVerify || bindings?.tlsInsecureSkipVerify || bindings?.insecureSkipVerify);
  if (!enabled) return {};
  return {
    skipTlsVerify: true,
    tlsInsecureSkipVerify: true,
    insecureSkipVerify: true,
  };
};

const buildHeaders = (ctx, extra = {}) => ({
  ...(ctx?.bindings?.headers || {}),
  'Content-Type': CONTENT_TYPE,
  ...extra,
});

const buildCookieHeader = (cookies) => {
  if (!cookies || typeof cookies !== 'object') return '';
  const parts = [];
  const fieldMap = {
    fromrootvsys: 'fromrootvsys',
    role: 'role',
    vsysId: 'vsysId',
    token: 'token',
    username: 'username',
    lang: 'lang',
  };
  for (const [key, cookieName] of Object.entries(fieldMap)) {
    const value = unwrapScalar(cookies[key]);
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${cookieName}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('; ');
};

const buildLoginPayload = (username, password, lang) => ({
  userName: username,
  password,
  encodeUserName: '0',
  encodePassword: '0',
  lang: lang || DEFAULT_LANG,
});

const asArray = (value) => {
  const raw = unwrapScalar(value);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.values)) return raw.values.map((item) => unwrapScalar(item));
  return [];
};

const normalizeAddrGroups = (groups) => {
  const list = asArray(groups);
  if (list.length === 0) return null;
  return list.map((group) => {
    const name = toTrimmedString(pickFirst(group, ['name']));
    if (!name) {
      throw errorWithCode('INVALID_ARGUMENT', 'addr_groups[].name is required');
    }
    const ip = asArray(pickFirst(group, ['ip'])).map((entry) => ({
      ip_addr: String(firstDefined(pickFirst(entry, ['ip_addr']), '') ?? ''),
      netmask: String(firstDefined(pickFirst(entry, ['netmask']), '32') ?? '32'),
      flag: toInteger(pickFirst(entry, ['flag']), 0),
    }));
    return { name, ip };
  });
};

const requireHost = (ctx) => {
  const host = resolveHost(ctx?.bindings || {});
  if (!host) throw errorWithCode('INVALID_ARGUMENT', 'host/baseUrl is required in bindings');
  return host;
};

const requireUsername = (ctx) => {
  const username = resolveUsername(ctx?.bindings || {});
  if (!username) throw errorWithCode('INVALID_ARGUMENT', 'username is required in bindings');
  return username;
};

const requirePassword = (ctx) => {
  const password = resolvePassword(ctx?.bindings || {});
  if (!password) throw errorWithCode('INVALID_ARGUMENT', 'password is required in bindings');
  return password;
};

const requireCookies = (req) => {
  const cookies = firstDefined(req?.cookies, req?.cookie);
  if (!cookies || typeof cookies !== 'object') {
    throw errorWithCode('INVALID_ARGUMENT', 'cookies is required');
  }
  if (!unwrapScalar(cookies.token)) {
    throw errorWithCode('INVALID_ARGUMENT', 'cookies.token is required');
  }
  return cookies;
};

const logFlow = (ctx, action, details) => {
  const meta = ctx?.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[HILLSTONE_FW_V55R6][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const fetchWithStatus = async (url, init, ctx) => {
  const callCtx = resolveCallContext(ctx);
  let res;
  try {
    res = await fetch(url, {
      timeoutMs: resolveTimeoutMs(callCtx),
      ...buildTlsOptions(callCtx.bindings),
      ...init,
    });
  } catch (err) {
    const errMsg = err?.cause?.message || err?.message || 'fetch failed';
    logFlow(callCtx, 'fetch:error', { url, error: errMsg });
    return { httpStatus: 0, httpBody: errMsg };
  }
  const httpStatus = res.status;
  const httpBody = await res.text();
  logFlow(callCtx, 'fetch:response', { url, httpStatus, bodyLength: httpBody?.length || 0 });
  return { httpStatus, httpBody };
};

const throwForStatus = (httpStatus, httpBody) => {
  const err = errorWithCode(
    httpStatus === 0 ? 'UNAVAILABLE' : 'FAILED_PRECONDITION',
    `upstream http ${httpStatus}: ${httpBody}`,
  );
  err.response = { http_status: httpStatus, http_body: httpBody };
  throw err;
};

const handleLogin = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const username = requireUsername(callCtx);
  const password = requirePassword(callCtx);
  const lang = toTrimmedString(firstDefined(req?.lang, DEFAULT_LANG)) || DEFAULT_LANG;
  const url = `${host}/rest/doc/login`;

  logFlow(callCtx, 'Login', { url, lang });
  const { httpStatus, httpBody } = await fetchWithStatus(url, {
    method: 'POST',
    headers: buildHeaders(callCtx),
    body: JSON.stringify(buildLoginPayload(username, password, lang)),
  }, callCtx);

  if (httpStatus >= 200 && httpStatus < 300) return { http_status: httpStatus, http_body: httpBody };
  throwForStatus(httpStatus, httpBody);
};

const handleCreateAddrGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const cookies = requireCookies(req);
  const addrGroups = normalizeAddrGroups(req?.addr_groups);
  if (!addrGroups) throw errorWithCode('INVALID_ARGUMENT', 'addr_groups is required and must be non-empty');
  const url = `${host}/rest/doc/addrbook`;

  logFlow(callCtx, 'CreateAddrGroup', { url, groups: addrGroups.length });
  const { httpStatus, httpBody } = await fetchWithStatus(url, {
    method: 'POST',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(cookies) }),
    body: JSON.stringify(addrGroups),
  }, callCtx);

  if (httpStatus >= 200 && httpStatus < 300) return { http_status: httpStatus, http_body: httpBody };
  throwForStatus(httpStatus, httpBody);
};

const handleUpdateAddrGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const cookies = requireCookies(req);
  const addrGroups = normalizeAddrGroups(req?.addr_groups);
  if (!addrGroups) throw errorWithCode('INVALID_ARGUMENT', 'addr_groups is required and must be non-empty');
  const url = `${host}/rest/doc/addrbook`;

  logFlow(callCtx, 'UpdateAddrGroup', { url, groups: addrGroups.length });
  const { httpStatus, httpBody } = await fetchWithStatus(url, {
    method: 'PUT',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(cookies) }),
    body: JSON.stringify(addrGroups),
  }, callCtx);

  if (httpStatus >= 200 && httpStatus < 300) return { http_status: httpStatus, http_body: httpBody };
  throwForStatus(httpStatus, httpBody);
};

const handleQueryAddrGroup = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const host = requireHost(callCtx);
  const cookies = requireCookies(req);
  const name = toTrimmedString(req?.name);
  if (!name) throw errorWithCode('INVALID_ARGUMENT', 'name is required');
  const limit = toInteger(firstDefined(req?.limit, DEFAULT_LIMIT), DEFAULT_LIMIT);
  if (limit <= 0) throw errorWithCode('INVALID_ARGUMENT', 'limit must be positive');
  const query = {
    conditions: [{ field: 'name', value: name }],
    start: 0,
    limit,
    page: 1,
  };
  const url = `${host}/rest/doc/addrbook?query=${encodeURIComponent(JSON.stringify(query))}`;

  logFlow(callCtx, 'QueryAddrGroup', { url, name, limit });
  const { httpStatus, httpBody } = await fetchWithStatus(url, {
    method: 'GET',
    headers: buildHeaders(callCtx, { Cookie: buildCookieHeader(cookies) }),
  }, callCtx);

  if (httpStatus >= 200 && httpStatus < 300) return { http_status: httpStatus, http_body: httpBody };
  throwForStatus(httpStatus, httpBody);
};

export function rpcdef(ctx) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOGIN_PATH]: async () => handleLogin(callCtx.req || {}, callCtx),
    [CREATE_ADDR_GROUP_PATH]: async () => handleCreateAddrGroup(callCtx.req || {}, callCtx),
    [UPDATE_ADDR_GROUP_PATH]: async () => handleUpdateAddrGroup(callCtx.req || {}, callCtx),
    [QUERY_ADDR_GROUP_PATH]: async () => handleQueryAddrGroup(callCtx.req || {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LOGIN_FULL]: (req, ctx = {}) => handleLogin(req, { ...ctx, req }),
  [METHOD_CREATE_ADDR_GROUP_FULL]: (req, ctx = {}) => handleCreateAddrGroup(req, { ...ctx, req }),
  [METHOD_UPDATE_ADDR_GROUP_FULL]: (req, ctx = {}) => handleUpdateAddrGroup(req, { ...ctx, req }),
  [METHOD_QUERY_ADDR_GROUP_FULL]: (req, ctx = {}) => handleQueryAddrGroup(req, { ...ctx, req }),
};

export const _test = {
  buildHeaders,
  buildCookieHeader,
  buildLoginPayload,
  buildTlsOptions,
  errorWithCode,
  normalizeAddrGroups,
  resolveHost,
  resolvePassword,
  resolveTimeoutMs,
  resolveUsername,
  throwForStatus,
  toInteger,
};
