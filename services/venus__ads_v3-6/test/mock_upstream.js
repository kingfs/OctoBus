import http from 'node:http';
import { URL } from 'node:url';

export const USERNAME = 'demo';
export const PASSWORD = 'demo';

const LOGIN_PATH = '/cnddos/v2.0/api/web_login/ddos';
const BLOCK_PATH = '/cnddos/v2.0/api/ip_bwlist/info';
const LOGOUT_PATH = '/cnddos/v2.0/api/web_logout/ddos';

const randomToken = () => `mock-token-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const collectBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) {
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

const jsonResponse = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

export function createMockServer({ username = USERNAME, password = PASSWORD } = {}) {
  const activeTokens = new Set();
  const blockedIps = new Set();
  const requests = [];

  const requireAuth = (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token || !activeTokens.has(token)) {
      jsonResponse(res, 401, { result: '-1', message: 'missing or invalid token' });
      return null;
    }
    return token;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers });
    try {
      if (req.method === 'POST' && url.pathname === LOGIN_PATH) {
        const body = await collectBody(req);
        if (body.username !== username || body.userpwd !== password) {
          jsonResponse(res, 200, { result: '-1', message: 'invalid credentials' });
          return;
        }
        const token = randomToken();
        activeTokens.add(token);
        jsonResponse(res, 200, { result: '0', message: { token } });
        return;
      }

      if (req.method === 'POST' && url.pathname === BLOCK_PATH) {
        const token = requireAuth(req, res);
        if (!token) return;
        const body = await collectBody(req);
        const ips = Array.isArray(body.ipadd) ? body.ipadd : [];
        let newCount = 0;
        for (const ip of ips) {
          const normalized = String(ip || '').trim();
          if (!normalized) continue;
          if (!blockedIps.has(normalized)) {
            blockedIps.add(normalized);
            newCount += 1;
          }
        }
        if (newCount === 0) jsonResponse(res, 200, { result: '-391201', message: 'already exists' });
        else jsonResponse(res, 200, { result: '0', message: `added ${newCount}` });
        return;
      }

      if (req.method === 'DELETE' && url.pathname === BLOCK_PATH) {
        const token = requireAuth(req, res);
        if (!token) return;
        const ip = (url.searchParams.get('iplist') || '').trim();
        if (!ip) {
          jsonResponse(res, 400, { result: '-1', message: 'iplist required' });
          return;
        }
        if (blockedIps.has(ip)) {
          blockedIps.delete(ip);
          jsonResponse(res, 200, { result: '0', message: 'removed' });
        } else {
          jsonResponse(res, 200, { result: '-391204', message: 'not found' });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === LOGOUT_PATH) {
        const token = requireAuth(req, res);
        if (!token) return;
        activeTokens.delete(token);
        jsonResponse(res, 200, { result: '0', message: 'logout ok' });
        return;
      }

      jsonResponse(res, 404, { result: '-1', message: 'unknown path' });
    } catch (err) {
      jsonResponse(res, 500, { result: '-1', message: err.message });
    }
  });

  return {
    requests,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      return `http://${address.address}:${address.port}/cnddos`;
    },
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
