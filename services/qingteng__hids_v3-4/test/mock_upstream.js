/* node:coverage disable */
import crypto from 'node:crypto';
import http from 'node:http';

const sha1Hex = (input) => crypto.createHash('sha1').update(String(input || ''), 'utf8').digest('hex');

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  req.on('error', reject);
});

const buildGetPayloadInfo = (url) => {
  const parsed = new URL(url, 'http://localhost');
  return Array.from(parsed.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}${value}`)
    .join('');
};

export const createMockServer = async (options = {}) => {
  const username = options.username || 'demo-user';
  const password = options.password || 'demo-pass';
  const comId = options.comId || 'demo-com-id';
  const jwt = options.jwt || 'demo-jwt';
  const signKey = options.signKey || 'demo-sign-key';
  const sessions = new Set([jwt]);
  const requests = [];

  const sendJson = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const verifySignedRequest = (req, body) => {
    const auth = req.headers.authorization || '';
    const reqComId = req.headers.comid || '';
    const timestamp = req.headers.timestamp || '';
    const sign = req.headers.sign || '';
    if (!String(auth).startsWith('Bearer ')) return { ok: false, reason: 'missing bearer token' };
    if (!sessions.has(String(auth).slice('Bearer '.length))) return { ok: false, reason: 'invalid jwt' };
    if (reqComId !== comId) return { ok: false, reason: 'invalid comId' };
    if (!timestamp || !sign) return { ok: false, reason: 'missing timestamp or sign' };
    const payloadInfo = req.method === 'GET' ? buildGetPayloadInfo(req.url || '/') : body;
    const expected = sha1Hex(`${comId}${payloadInfo}${timestamp}${signKey}`);
    if (expected !== sign) return { ok: false, reason: 'invalid sign' };
    return { ok: true };
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', 'http://localhost');
      const body = await readBody(req);
      requests.push({ method: req.method, url: req.url, body, headers: req.headers });

      if (req.method === 'POST' && url.pathname === '/v1/api/auth') {
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch {
          sendJson(res, 400, { message: 'bad json' });
          return;
        }
        if (parsed.username !== username || parsed.password !== password) {
          sendJson(res, 401, { message: 'invalid credentials' });
          return;
        }
        sendJson(res, 200, { code: 0, data: { comId, jwt, signKey } });
        return;
      }

      const verified = verifySignedRequest(req, body);
      if (!verified.ok) {
        sendJson(res, 401, { message: verified.reason });
        return;
      }

      if (req.method === 'GET' && /^\/external\/api\/assets\/host\/(linux|win)$/.test(url.pathname)) {
        const ip = url.searchParams.get('ip') || '';
        const systemType = url.pathname.split('/').at(-1);
        sendJson(res, 200, {
          total: 1,
          rows: [{ displayIp: ip, agentId: `${systemType}-${ip}`, hostName: `qt-${systemType}` }],
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/external/api/ms-srv/api/segmentation/create') {
        const parsed = body ? JSON.parse(body) : {};
        sendJson(res, 200, { code: 0, direction: parsed.direction, remark: parsed.remark, agentIds: parsed.agentIds || [] });
        return;
      }

      if (req.method === 'DELETE' && url.pathname === '/external/api/ms-srv/api/segmentation/realDel') {
        const parsed = body ? JSON.parse(body) : {};
        sendJson(res, 200, { code: 0, removed: Array.isArray(parsed.agentIds) ? parsed.agentIds.length : 0, agentIds: parsed.agentIds || [] });
        return;
      }

      sendJson(res, 404, { message: 'not found' });
    })().catch((err) => {
      sendJson(res, 500, { message: err?.message || 'internal error' });
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
