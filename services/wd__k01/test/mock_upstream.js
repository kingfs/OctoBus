import http from 'node:http';

export const USERNAME = 'admin';
export const PASSWORD = 'secret';

const readBody = async (req) => new Promise((resolve) => {
  let buf = '';
  req.on('data', (chunk) => {
    buf += chunk;
  });
  req.on('end', () => resolve(buf));
});

const send = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
};

const notFound = (res) => {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
};

export function createMockServer({ username = USERNAME, password = PASSWORD } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    requests.push({ method: req.method, path: url.pathname, headers: req.headers });

    if (req.method === 'POST' && url.pathname === '/api/cms/user/login') {
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        send(res, 400, { error: 'invalid json' });
        return;
      }
      if (parsed.username !== username || parsed.password !== password) {
        send(res, 200, { error: 'missing credentials' });
        return;
      }
      send(res, 200, { token: { access_token: 'mock-token' } });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/security/iplist/save') {
      const auth = String(req.headers.authorization || '');
      if (!auth.startsWith('Bearer ')) {
        send(res, 401, { msgType: 'error', msg: 'unauthorized' });
        return;
      }
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        send(res, 400, { msgType: 'error', msg: 'invalid json' });
        return;
      }
      const item = Array.isArray(parsed.items) ? parsed.items[0] : null;
      if (!parsed.method || !item) {
        send(res, 200, { msgType: 'error', msg: 'bad request' });
        return;
      }
      if (parsed.method === 'add') {
        send(res, 200, { msgType: 'success', msg: 'add ok' });
        return;
      }
      if (parsed.method === 'delete') {
        send(res, 200, { msgType: 'success', msg: 'delete ok' });
        return;
      }
      send(res, 200, { msgType: 'error', msg: `unknown method: ${parsed.method}` });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/cms/user/logout') {
      send(res, 200, { ok: true });
      return;
    }

    notFound(res);
  });

  return {
    requests,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      return `http://${address.address}:${address.port}`;
    },
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
