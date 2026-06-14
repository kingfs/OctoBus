/* node:coverage disable */
import crypto from 'node:crypto';
import http from 'node:http';

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch (err) {
      reject(err);
    }
  });
  req.on('error', reject);
});

export const createMockServer = async ({ apiKey = 'demoKey', secret = 'demoSecret' } = {}) => {
  const entries = new Map();
  const requests = [];
  let autoId = 1;

  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };

  const verifySignature = (url) => {
    const parsed = new URL(url, 'http://localhost');
    const ts = parsed.searchParams.get('timestamp');
    const key = parsed.searchParams.get('apikey');
    const sign = parsed.searchParams.get('sign') || '';
    if (!ts || !key || !sign) return false;
    if (key !== apiKey) return false;
    const expected = crypto.createHmac('sha1', secret).update(`${apiKey}${ts}`).digest('base64');
    return expected === sign;
  };

  const withAuth = async (req, res, handler) => {
    if (!verifySignature(req.url || '')) {
      sendJson(res, 401, { responseCode: 401, verboseMsg: 'invalid signature' });
      return;
    }
    try {
      await handler();
    } catch (err) {
      sendJson(res, 500, { responseCode: 500, verboseMsg: err?.message || 'internal error' });
    }
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const path = (req.url || '').split('?', 1)[0] || '';
      if (req.method === 'POST' && path === '/v3/blacklist/inbound/list') {
        return withAuth(req, res, async () => {
          const body = await readBody(req);
          requests.push({ method: req.method, path, body });
          if (body.search === 'bizfail') {
            sendJson(res, 200, { responseCode: 1001, verboseMsg: 'business failed' });
            return;
          }
          const pageNo = Number(body.pageNo || 1);
          const pageSize = Number(body.pageSize || 20);
          const list = Array.from(entries.values());
          const start = (pageNo - 1) * pageSize;
          sendJson(res, 200, {
            responseCode: 0,
            verboseMsg: 'ok',
            data: {
              total: list.length,
              pageNo,
              pageSize,
              list: list.slice(start, start + pageSize),
            },
          });
        });
      }

      if (req.method === 'POST' && path === '/v3/blacklist/inbound') {
        return withAuth(req, res, async () => {
          const body = await readBody(req);
          requests.push({ method: req.method, path, body });
          const objects = Array.isArray(body.object) ? body.object : [];
          objects.forEach((ip) => {
            const id = String(autoId++);
            entries.set(id, {
              id,
              object: ip,
              objectType: body.objectType || 'ip',
              lifeCycle: body.lifeCycle || 0,
              comments: body.comments || '',
              threatName: body.threatName || '',
              state: 'enabled',
            });
          });
          sendJson(res, 200, { responseCode: 0, verboseMsg: 'ok', data: { list: Array.from(entries.values()) } });
        });
      }

      if (req.method === 'DELETE' && path === '/v3/blacklist/inbound') {
        return withAuth(req, res, async () => {
          const body = await readBody(req);
          requests.push({ method: req.method, path, body });
          const ids = Array.isArray(body.ids) ? body.ids : [];
          ids.forEach((id) => entries.delete(String(id)));
          sendJson(res, 200, { responseCode: 0, verboseMsg: 'ok', data: { removed: ids.length } });
        });
      }

      sendJson(res, 404, { responseCode: 404, verboseMsg: 'not found' });
    })().catch((err) => sendJson(res, 500, { responseCode: 500, verboseMsg: err?.message || 'internal error' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
