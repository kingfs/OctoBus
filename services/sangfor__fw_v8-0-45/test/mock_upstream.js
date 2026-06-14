/* node:coverage disable */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const LOGIN_PATH = '/api/v1/namespaces/public/login';
const BLOCK_PATH = '/api/batch/v1/namespaces/public/whiteblacklist';
const LOGOUT_PATH = '/api/v1/namespaces/public/logout';

export const createMockServer = async (options = {}) => {
  const requests = [];
  const user = options.user || 'api_user';
  const password = options.password || 'SuperSecret!';
  const tokens = new Map();
  const blacklist = new Map();

  const sendJson = (res, payload, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });

  const readJsonBody = async (req) => {
    const raw = await readBody(req);
    return raw.trim() ? JSON.parse(raw) : null;
  };

  const extractToken = (req) => {
    const cookieHeader = req.headers.cookie || '';
    for (const part of cookieHeader.split(';')) {
      const [key, val] = part.trim().split('=');
      if (key === 'token') return decodeURIComponent(val || '');
    }
    return '';
  };

  const ensureToken = (req, res) => {
    const token = extractToken(req);
    if (!token || !tokens.has(token)) {
      sendJson(res, { code: 4010, message: 'invalid token', data: null });
      return '';
    }
    return token;
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'POST' && requestUrl.pathname === LOGIN_PATH) {
        const body = (await readJsonBody(req)) || {};
        requests.push({ stage: 'login', method: req.method, url: req.url, headers: req.headers, body });
        if (body.name !== user || body.password !== password || options.failLogin) {
          sendJson(res, { code: 4001, message: 'invalid credentials', data: null });
          return;
        }
        const token = randomUUID();
        tokens.set(token, { user, createdAt: Date.now() });
        sendJson(res, { code: 0, message: 'success', data: { loginResult: { token, user } } });
        return;
      }
      if (req.method === 'POST' && requestUrl.pathname === BLOCK_PATH && requestUrl.searchParams.get('_method') === 'delete') {
        if (!ensureToken(req, res)) return;
        const body = (await readJsonBody(req)) || [];
        requests.push({ stage: 'unblock', method: req.method, url: req.url, headers: req.headers, body });
        const removed = [];
        const missing = [];
        for (const item of Array.isArray(body) ? body : []) {
          const ip = String(item?.url || '').trim();
          if (!ip) continue;
          if (blacklist.has(ip)) {
            blacklist.delete(ip);
            removed.push(ip);
          } else {
            missing.push(ip);
          }
        }
        const code = removed.length ? 0 : missing.length ? 1004 : 0;
        sendJson(res, { code, message: code === 0 ? 'success' : 'not found', data: { removed, missing, size: blacklist.size } });
        return;
      }
      if (req.method === 'POST' && requestUrl.pathname === BLOCK_PATH) {
        if (!ensureToken(req, res)) return;
        const body = (await readJsonBody(req)) || [];
        requests.push({ stage: 'block', method: req.method, url: req.url, headers: req.headers, body });
        const added = [];
        const existed = [];
        for (const item of Array.isArray(body) ? body : []) {
          const ip = String(item?.url || '').trim();
          if (!ip) continue;
          if (blacklist.has(ip)) {
            existed.push(ip);
          } else {
            blacklist.set(ip, { description: item?.description || 'Block IP' });
            added.push(ip);
          }
        }
        const code = added.length ? 0 : existed.length ? 17 : 0;
        sendJson(res, { code, message: code === 0 ? 'success' : 'already exists', data: { added, existed, size: blacklist.size } });
        return;
      }
      if (req.method === 'POST' && requestUrl.pathname === LOGOUT_PATH) {
        const token = ensureToken(req, res);
        if (!token) return;
        const body = (await readJsonBody(req)) || {};
        requests.push({ stage: 'logout', method: req.method, url: req.url, headers: req.headers, body });
        tokens.delete(token);
        sendJson(res, { code: 0, message: 'logout success', data: null });
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    })().catch((err) => {
      sendJson(res, { code: 5000, message: err?.message || 'internal error', data: null }, 500);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
