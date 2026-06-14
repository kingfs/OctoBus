/* node:coverage disable */
import http from 'node:http';

export const createMockServer = async () => {
  const requests = [];

  const jsonResponse = (res, status, payload, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(payload));
  };

  const parseBody = (req) =>
    new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({ raw: body });
        }
      });
    });

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method === 'GET' && url.pathname === '/webui/login/auth') {
        requests.push({ method: req.method, url: req.url, query: Object.fromEntries(url.searchParams), headers: req.headers });
        jsonResponse(res, 200, { result: 'ok', uuid: `mock-${Date.now()}`, user: url.searchParams.get('user') }, {
          'set-cookie': ['SID=abc; Path=/', 'lang=zh-cn; Path=/'],
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/webui/blacklist/set') {
        const body = await parseBody(req);
        requests.push({ method: req.method, url: req.url, query: Object.fromEntries(url.searchParams), body, headers: req.headers });
        const undo = body.undo === '1';
        jsonResponse(res, 200, {
          action: undo ? 'undo' : 'block',
          target: body.ip,
          mask: body.mask,
          desc: body.desc || '',
          uuid: url.searchParams.get('uuid'),
        });
        return;
      }

      jsonResponse(res, 404, { status: 'not_found', path: url.pathname });
    })().catch((err) => {
      jsonResponse(res, 500, { message: err?.message || 'internal error' });
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
