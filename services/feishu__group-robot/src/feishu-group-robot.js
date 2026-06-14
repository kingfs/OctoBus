import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_SEND_TEXT_PATH = '/Feishu_GroupRobot.Feishu_GroupRobot/SendTextMessage';
export const METHOD_SEND_TEXT_FULL = 'Feishu_GroupRobot.Feishu_GroupRobot/SendTextMessage';
export const DEFAULT_TIMEOUT_MS = 5000;
export const SUCCESS_STATUS_CODES = new Set([200, 209, 210]);

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), message);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const coerceString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) {
    return coerceString(value.value);
  }
  return String(value);
};

const normalizeWebhook = (url) => {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
};

const resolveBindingString = (bindings, keys) => {
  for (const key of keys) {
    if (hasOwn(bindings, key)) {
      const value = coerceString(bindings[key]).trim();
      if (value) return value;
    }
  }
  return '';
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

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const raw = Number(firstDefined(bindings.timeoutMs, bindings.timeout_ms, ctx?.limits?.timeoutMs, DEFAULT_TIMEOUT_MS));
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

const createLogger = (meta = {}) => (action, details) => {
  const inst = meta.instance_id || meta.instanceId;
  const reqId = meta.request_id || meta.requestId;
  const trace = [];
  if (inst) trace.push(`inst=${inst}`);
  if (reqId) trace.push(`req=${reqId}`);
  const prefix = `[Feishu_GroupRobot][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const redactWebhook = (url) => String(url).replace(/\/hook\/[^/?#]+/, '/hook/***');

const buildHeaders = (ctx) => {
  const bindings = mergedBindings(ctx);
  return {
    ...((bindings.headers && typeof bindings.headers === 'object') ? bindings.headers : {}),
    'Content-Type': 'application/json',
    'User-Agent': 'chaitin-cosmos',
    'x-engine-instance': ctx?.meta?.instance_id || ctx?.meta?.instanceId || 'unknown',
    'x-request-id': ctx?.meta?.request_id || ctx?.meta?.requestId || 'unknown',
  };
};

const buildPayload = (message) => ({
  msg_type: 'text',
  content: {
    text: message,
  },
});

const sendToFeishu = async (ctx, webhook, payload, log) => {
  log('SendTextMessage:start', {
    webhook: redactWebhook(webhook),
    messageLength: payload.content.text.length,
  });

  let res;
  try {
    res = await fetch(webhook, {
      method: 'POST',
      headers: buildHeaders(ctx),
      body: JSON.stringify(payload),
      timeoutMs: resolveTimeoutMs(ctx),
      ...buildTlsOptions(ctx.bindings || {}),
    });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    throw errorWithCode('UNAVAILABLE', reason);
  }

  const httpStatus = Number(res.status || 0);
  const httpBody = String((await res.text()) ?? '');
  log('SendTextMessage:response', {
    httpStatus,
    httpBodyLength: httpBody.length,
  });

  if (!SUCCESS_STATUS_CODES.has(httpStatus)) {
    throw errorWithCode('UNAVAILABLE', `upstream http ${httpStatus}: ${httpBody}`);
  }

  return {
    http_status: httpStatus,
    http_body: httpBody,
  };
};

const handleSendTextMessage = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const webhook = normalizeWebhook(resolveBindingString(callCtx.bindings, ['webhook', 'webhook_url', 'webhookUrl', 'url']));
  if (!webhook) {
    throw errorWithCode('INVALID_ARGUMENT', 'webhook is required (https://open.feishu.cn/open-apis/bot/v2/hook/{token})');
  }

  const message = coerceString(firstDefined(req?.message, req?.send_msg, req?.sendMsg, req?.text)).trim();
  if (!message) {
    throw errorWithCode('INVALID_ARGUMENT', 'message is required');
  }

  return sendToFeishu(callCtx, webhook, buildPayload(message), createLogger(callCtx.meta));
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_SEND_TEXT_PATH]: (req = callCtx.req) => handleSendTextMessage(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.req ?? ctx?.request ?? {});

export const handlers = {
  [METHOD_SEND_TEXT_FULL]: (ctx) => callSdkHandler(ctx, METHOD_SEND_TEXT_PATH),
};

rpcdef.__test__ = {
  buildHeaders,
  buildPayload,
  buildTlsOptions,
  coerceString,
  createLogger,
  errorWithCode,
  firstDefined,
  hasOwn,
  handleSendTextMessage,
  mergedBindings,
  normalizeWebhook,
  redactWebhook,
  registerHandlers,
  resolveBindingString,
  resolveCallContext,
  resolveTimeoutMs,
  sendToFeishu,
};

export const _test = rpcdef.__test__;
