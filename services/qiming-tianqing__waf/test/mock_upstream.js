/* node:coverage disable */
import http from 'node:http';

export const createMockServer = async () => {
  const requests = [];
  const blocked = new Map();
  const storedObjects = new Map();

  const jsonResponse = (res, status, payload, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(payload));
  };

  const parseBody = (req) => new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({ __invalid__: true, raw: body });
      }
    });
  });

  const headersOk = (req) => {
    const authorization = req.headers.authorization;
    const cookie = req.headers.cookie;
    return Boolean(authorization) && /SID=/.test(String(cookie || ''));
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

      if (req.method === 'POST' && url.pathname === '/api/mgr/login') {
        const body = await parseBody(req);
        requests.push({ method: req.method, url: req.url, body, headers: req.headers });
        if (body.__invalid__) {
          jsonResponse(res, 400, { code: 400, msg: 'invalid json' });
          return;
        }
        if (!body.name || !body.password) {
          jsonResponse(res, 200, { code: 401, msg: 'missing name/password' }, { 'set-cookie': 'SID=mock-invalid; Path=/' });
          return;
        }
        jsonResponse(res, 200, { code: 0, msg: 'ok', data: { authorization: 'Bearer mock-token' } }, {
          'set-cookie': 'SID=mock-session; Path=/; HttpOnly',
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/addressobject/addAddrObj') {
        const body = await parseBody(req);
        requests.push({ method: req.method, url: req.url, body, headers: req.headers });
        if (!headersOk(req)) {
          jsonResponse(res, 401, { code: 401, msg: 'unauthorized' });
          return;
        }
        const ip = body.content || body.addrObjContent || body.ip;
        if (!ip) {
          jsonResponse(res, 200, { code: 4001, msg: 'content/ip required' });
          return;
        }
        const id = `addr-${ip}`;
        storedObjects.set(id, { ...body, id });
        jsonResponse(res, 200, { code: 0, msg: 'ok', data: { id } });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/blacklist/add_submit') {
        const body = await parseBody(req);
        requests.push({ method: req.method, url: req.url, body, headers: req.headers });
        if (!headersOk(req)) {
          jsonResponse(res, 401, { code: 401, msg: 'unauthorized' });
          return;
        }
        const ip = body.ip || body.list?.[0]?.ip;
        if (!ip) {
          jsonResponse(res, 200, { code: 4002, msg: 'ip missing' });
          return;
        }
        blocked.set(ip, body);
        jsonResponse(res, 200, { code: 0, msg: 'ok', data: { blocked: Array.from(blocked.keys()) } });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/blacklist/delete') {
        const body = await parseBody(req);
        requests.push({ method: req.method, url: req.url, body, headers: req.headers });
        if (!headersOk(req)) {
          jsonResponse(res, 401, { code: 401, msg: 'unauthorized' });
          return;
        }
        const ip = body.ip || body.list?.[0]?.ip;
        if (!ip) {
          jsonResponse(res, 200, { code: 4003, msg: 'ip missing' });
          return;
        }
        blocked.delete(ip);
        jsonResponse(res, 200, { code: 0, msg: 'ok', data: { blocked: Array.from(blocked.keys()) } });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/login/logout') {
        const body = await parseBody(req);
        requests.push({ method: req.method, url: req.url, body, headers: req.headers });
        if (!headersOk(req)) {
          jsonResponse(res, 401, { code: 401, msg: 'unauthorized' });
          return;
        }
        jsonResponse(res, 200, { code: 0, msg: 'ok' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/__status') {
        requests.push({ method: req.method, url: req.url, headers: req.headers });
        jsonResponse(res, 200, {
          blocked: Array.from(blocked.keys()),
          objects: Array.from(storedObjects.keys()),
        });
        return;
      }

      jsonResponse(res, 404, { code: 404, msg: 'not found', path: url.pathname });
    })().catch((err) => {
      jsonResponse(res, 500, { code: 500, msg: err?.message || 'internal error' });
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
