/* node:coverage disable */
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

export const LOGIN_URI = '/api/system/account/login/login';
export const BLACKLIST_URI = '/api/policy/globalList/black/manual';
export const APPLYCONFIG_URI = '/api/index/applyconfig';

const sha256Hex = (text) => createHash('sha256').update(String(text || ''), 'utf8').digest('hex');

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve(null);
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

const parseCookieHeader = (cookieHeader) => {
  const result = {};
  const raw = String(cookieHeader || '').trim();
  if (!raw) return result;
  for (const part of raw.split(';')) {
    const [key, value] = part.trim().split('=');
    if (key) result[key] = value || '';
  }
  return result;
};

export const createMockServer = async ({ username = 'api_user', password = 'SuperSecret!' } = {}) => {
  const state = {
    blacklist: new Map(),
    sessions: new Map(),
    nextId: 1550000,
    requests: [],
  };

  const sendJson = (res, payload, status = 200, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(payload));
  };

  const ensureSignedSession = (req, res, pathname) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const cookies = parseCookieHeader(req.headers?.cookie);
    const session = cookies.sid ? state.sessions.get(cookies.sid) : null;
    const apikey = requestUrl.searchParams.get('apikey');
    const time = requestUrl.searchParams.get('time');
    const sign = requestUrl.searchParams.get('sign');

    if (!session) {
      sendJson(res, { code: 4010, message: 'missing or invalid session', data: null });
      return null;
    }
    if (!apikey || !time || !sign) {
      sendJson(res, { code: 4011, message: 'missing sign params', data: null });
      return null;
    }
    const expected = sha256Hex(`security-key:${session.securityKey};api-key:${session.apiKey};time:${time};rest-uri:${pathname}`);
    if (apikey !== session.apiKey || sign !== expected) {
      sendJson(res, { code: 4013, message: 'invalid sign', data: { expected, got: sign } });
      return null;
    }
    return { requestUrl, session };
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

      if (req.method === 'POST' && requestUrl.pathname === LOGIN_URI) {
        const body = (await readJsonBody(req)) || {};
        state.requests.push({ method: req.method, pathname: requestUrl.pathname, body, headers: req.headers });
        if (body.username !== username || body.password !== password) {
          sendJson(res, { code: 4001, message: 'invalid credentials', data: null });
          return;
        }
        const apiKey = randomUUID().replaceAll('-', '').slice(0, 20);
        const securityKey = randomUUID().replaceAll('-', '').slice(0, 20);
        const sid = randomUUID().replaceAll('-', '');
        state.sessions.set(sid, { apiKey, securityKey, username, loginAt: Date.now() });
        sendJson(
          res,
          { code: 2000, message: 'success', data: { api_key: apiKey, security_key: securityKey } },
          200,
          { 'Set-Cookie': [`sid=${sid}; Path=/; HttpOnly`] },
        );
        return;
      }

      if (requestUrl.pathname === BLACKLIST_URI) {
        const signed = ensureSignedSession(req, res, BLACKLIST_URI);
        if (!signed) return;

        if (req.method === 'GET') {
          state.requests.push({ method: req.method, pathname: requestUrl.pathname, query: Object.fromEntries(requestUrl.searchParams), headers: req.headers });
          const pageSize = Number(requestUrl.searchParams.get('pageSize') || 6000);
          const pageNo = Number(requestUrl.searchParams.get('pageNo') || 1);
          const all = Array.from(state.blacklist.values());
          const start = Math.max(0, (pageNo - 1) * pageSize);
          sendJson(res, { code: 2000, message: 'success', data: { data: all.slice(start, start + pageSize) } });
          return;
        }

        if (req.method === 'POST') {
          const body = (await readJsonBody(req)) || {};
          state.requests.push({ method: req.method, pathname: requestUrl.pathname, query: Object.fromEntries(requestUrl.searchParams), body, headers: req.headers });
          if (body.action === 'insert') {
            const ip = String(body?.data?.name || '').trim();
            const id = state.nextId++;
            state.blacklist.set(ip, {
              id,
              name: ip,
              start_time: String(body?.data?.start_time ?? ''),
              end_time: String(body?.data?.end_time ?? ''),
              abstract: String(body?.data?.abstract ?? ''),
              enabled: 'true',
              threat_type: String(body?.data?.threat_type ?? '9'),
            });
            sendJson(res, { code: 2000, message: 'success', data: null });
            return;
          }
          if (body.action === 'delete') {
            const removed = [];
            for (const id of Array.isArray(body.data) ? body.data : []) {
              for (const [ip, item] of state.blacklist.entries()) {
                if (item.id === Number(id)) {
                  state.blacklist.delete(ip);
                  removed.push(Number(id));
                  break;
                }
              }
            }
            sendJson(res, { code: 2000, message: 'success', data: { removed } });
            return;
          }
          sendJson(res, { code: 4002, message: 'invalid action', data: null });
          return;
        }

        sendJson(res, { code: 4050, message: 'method not allowed', data: null }, 405);
        return;
      }

      if (req.method === 'POST' && requestUrl.pathname === APPLYCONFIG_URI) {
        const signed = ensureSignedSession(req, res, APPLYCONFIG_URI);
        if (!signed) return;
        const body = (await readJsonBody(req)) || {};
        state.requests.push({ method: req.method, pathname: requestUrl.pathname, query: Object.fromEntries(requestUrl.searchParams), body, headers: req.headers });
        sendJson(res, { code: 2000, message: 'apply config success', data: null });
        return;
      }

      sendJson(res, { code: 4040, message: 'not found', data: null }, 404);
    })().catch((err) => {
      sendJson(res, { code: 5000, message: err?.message || 'internal error', data: null }, 500);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests: state.requests,
    state,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
