import http from 'node:http';
import { randomUUID } from 'node:crypto';

export const USER = 'tenant-user';
export const API_KEY = 'demo_api_key';
export const LABEL_CODE = 'LAB-MOCK';
export const DATE_HEADER = 'Thu, 26 Feb 2026 08:07:15 GMT';

const BASE_PATH = '/api/spider/label-ip-forbid/operate';

const sendJson = (res, payload, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 2 * 1024 * 1024) req.destroy(new Error('payload too large'));
  });
  req.on('end', () => {
    if (!raw.trim()) {
      resolve({});
      return;
    }
    try {
      resolve(JSON.parse(raw));
    } catch (err) {
      reject(err);
    }
  });
  req.on('error', reject);
});

const parseBasicAuth = (header) => {
  if (!header || typeof header !== 'string' || !header.startsWith('Basic ')) return null;
  try {
    const value = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const idx = value.indexOf(':');
    return idx === -1 ? { user: value, password: '' } : { user: value.slice(0, idx), password: value.slice(idx + 1) };
  } catch {
    return null;
  }
};

const keyFor = (label, ip) => `${label}__${ip}`;
const shouldFailIp = (ip) => /fail/i.test(ip);

export function createMockServer({ expectedUser = USER } = {}) {
  const requests = [];
  const forbidden = new Map();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    requests.push({ method: req.method, path: url.pathname, headers: req.headers });
    if (req.method !== 'POST' || url.pathname !== BASE_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }

    const simulate = String(req.headers['x-wangsu-simulate'] || '').toLowerCase();
    if (simulate === 'http-500') {
      sendJson(res, { code: '9999', message: 'simulated upstream 500', data: null }, 500);
      return;
    }
    if (simulate === 'biz-error') {
      sendJson(res, { code: '8001', message: 'simulated business error', data: null });
      return;
    }

    const auth = parseBasicAuth(req.headers.authorization);
    if (!auth) {
      sendJson(res, { code: '4010', message: 'missing or invalid Authorization header', data: null }, 401);
      return;
    }
    if (expectedUser && auth.user !== expectedUser) {
      sendJson(res, { code: '4011', message: 'unknown user', data: null }, 403);
      return;
    }
    if (!req.headers.date) {
      sendJson(res, { code: '4001', message: 'Date header is required', data: null }, 400);
      return;
    }
    if (req.headers['x-wangsu-user'] && req.headers['x-wangsu-user'] !== auth.user) {
      sendJson(res, { code: '4002', message: 'X-Wangsu-User mismatch', data: null }, 400);
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, { code: '4000', message: err?.message || 'body must be JSON', data: null }, 400);
      return;
    }

    const objects = Array.isArray(body?.operationObjectList) ? body.operationObjectList : [];
    if (!objects.length) {
      sendJson(res, { code: '1002', message: 'operationObjectList is required', data: null }, 400);
      return;
    }
    const target = objects[0] || {};
    const labelCode = String(target.labelCode || '').trim() || 'DEFAULT_TAG';
    const ips = Array.isArray(target.ipList) ? target.ipList.map((ip) => String(ip || '').trim()).filter(Boolean) : [];
    if (!ips.length) {
      sendJson(res, { code: '1003', message: 'ipList is required', data: null }, 400);
      return;
    }
    const operationType = Number(body.operationType);
    if (![1, 2].includes(operationType)) {
      sendJson(res, { code: '1004', message: 'operationType must be 1 (forbid) or 2 (unforbid)', data: null }, 400);
      return;
    }
    if (operationType === 1 && (body.forbidTime === undefined || Number(body.forbidTime) <= 0)) {
      sendJson(res, { code: '1005', message: 'forbidTime is required for forbid operation', data: null }, 400);
      return;
    }

    const failed = [];
    const processed = [];
    const now = Date.now();
    for (const ip of ips) {
      if (shouldFailIp(ip)) {
        failed.push(ip);
        continue;
      }
      const key = keyFor(labelCode, ip);
      if (operationType === 1) {
        forbidden.set(key, { ip, labelCode, expiresAt: body.forbidTime ? now + Number(body.forbidTime) * 60 * 1000 : null });
        processed.push(ip);
      } else if (forbidden.has(key)) {
        forbidden.delete(key);
        processed.push(ip);
      } else {
        failed.push(ip);
      }
    }

    sendJson(res, {
      code: '0',
      message: failed.length ? 'partial success' : 'success',
      data: {
        requestId: req.headers['x-request-id'] || randomUUID(),
        failedIpList: failed,
        processedIpList: processed,
        labelCode,
        operationType,
        forbidTime: body.forbidTime,
        remainingBlocked: forbidden.size,
      },
    });
  });

  return {
    requests,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      return `http://${address.address}:${address.port}${BASE_PATH}`;
    },
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
