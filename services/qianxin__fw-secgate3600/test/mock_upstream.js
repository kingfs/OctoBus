/* node:coverage disable */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export const createMockServer = async ({ user = 'api_user', password = 'SuperSecret!', emptyLogoutUser = user } = {}) => {
  const state = {
    sessions: new Map(),
    groups: new Map(),
    requests: [],
  };

  const sendJson = (res, payload, status = 200, extraHeaders = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
    res.end(JSON.stringify(payload));
  };

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

  const parseCookieHeader = (headerValue) => {
    const out = {};
    for (const part of String(headerValue || '').split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      out[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
    }
    return out;
  };

  const getSession = (req) => {
    const cookies = parseCookieHeader(req.headers?.cookie);
    const token = String(cookies.token || '').trim();
    const sid = String(cookies.SID || cookies.sid || '').trim();
    const session = token ? state.sessions.get(token) : null;
    if (!session) return null;
    if (sid && session.sid !== sid) return null;
    return session;
  };

  const normalizeObjAddr = (obj) => ({
    name: String(obj?.name || '').trim(),
    oldname: String(obj?.oldname || '').trim(),
    desc: String(obj?.desc || ''),
    include: Array.isArray(obj?.include)
      ? obj.include.map((item) => ({ ip: String(item?.ip || '').trim(), addr_type: String(item?.addr_type || '').trim() || 'host' }))
      : [],
    exclude: Array.isArray(obj?.exclude)
      ? obj.exclude.map((item) => ({ ip: String(item?.ip || '').trim(), addr_type: String(item?.addr_type || '').trim() || 'host' }))
      : [],
  });

  const server = http.createServer((req, res) => {
    (async () => {
      if (req.method === 'POST' && req.url === '/v1.0/login') {
        const body = (await readJsonBody(req)) || {};
        state.requests.push({ method: req.method, url: req.url, body, headers: req.headers });
        const username = String(body?.username || '').trim();
        const reqPassword = String(body?.password || '').trim();
        if (username === user && reqPassword === 'protocol-anomaly') {
          sendJson(res, { success: true, result: [] });
          return;
        }
        if (username !== user || reqPassword !== password) {
          sendJson(res, { success: false, result: { error_code: 'bad_password', token: '' } });
          return;
        }
        const token = `token-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const sid = `sid-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
        state.sessions.set(token, { token, sid, username });
        sendJson(res, { success: true, result: { error_code: 'success', token } }, 200, {
          'Set-Cookie': [`SID=${sid}; Path=/; HttpOnly`, 'lang=zh-cn; Path=/'],
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/v1.0/rest/') {
        const session = getSession(req);
        const body = (await readJsonBody(req)) || [];
        state.requests.push({ method: req.method, url: req.url, body, headers: req.headers });
        if (!session) {
          sendJson(res, { head: { error_code: 4010, message: 'missing or invalid session' }, body: {} }, 401);
          return;
        }
        const groupName = String(body?.[0]?.body?.obj_addr?.[0]?.name || '').trim();
        if (groupName === 'force_http_401') {
          state.sessions.delete(session.token);
          sendJson(res, { head: { error_code: 4010, message: 'expired' }, body: {} }, 401);
          return;
        }
        if (groupName === 'force_http_500') {
          sendJson(res, { head: { error_code: 5001, message: 'forced 500' }, body: { retry: false } }, 500);
          return;
        }
        const updated = [];
        for (const entry of Array.isArray(body) ? body : []) {
          for (const rawObj of Array.isArray(entry?.body?.obj_addr) ? entry.body.obj_addr : []) {
            const obj = normalizeObjAddr(rawObj);
            state.groups.set(obj.name, obj);
            updated.push(obj.name);
          }
        }
        sendJson(res, { head: { error_code: 0, message: 'success' }, body: { updated, total_groups: state.groups.size } });
        return;
      }

      if (req.method === 'POST' && req.url === '/v1.0/out') {
        const session = getSession(req);
        const body = (await readJsonBody(req)) || {};
        state.requests.push({ method: req.method, url: req.url, body, headers: req.headers });
        if (!session) {
          sendJson(res, { head: { error_code: 4010, message: 'missing or invalid session' }, body: {} }, 401);
          return;
        }
        const username = String(body?.username || '').trim();
        if (username && username !== session.username) {
          sendJson(res, { code: 4001, message: 'username mismatch' });
          return;
        }
        state.sessions.delete(session.token);
        if (session.username === emptyLogoutUser) {
          res.writeHead(204, { 'x-trace-id': 'logout-ok' });
          res.end('');
          return;
        }
        sendJson(res, { code: 0, message: 'logout success' });
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    })().catch((err) => {
      sendJson(res, { code: 5000, message: err?.message || 'internal error' }, 500);
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
