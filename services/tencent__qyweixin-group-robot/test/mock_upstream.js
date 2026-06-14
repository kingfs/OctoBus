/* node:coverage disable */
import http from 'node:http';

export const createMockServer = async () => {
  const requests = [];

  const readBody = (req) => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });

  const sendJson = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain' });
        res.end('method not allowed');
        return;
      }
      if (url.pathname !== '/cgi-bin/webhook/send') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }

      const rawBody = await readBody(req);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: rawBody });
      const key = url.searchParams.get('key') || 'ok';

      if (key === 'unauthorized') {
        sendJson(res, 401, { errcode: 40014, errmsg: 'invalid key' });
        return;
      }
      if (key === 'noerrcode') {
        sendJson(res, 200, { errmsg: 'ok' });
        return;
      }
      if (key === 'badjson') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"errmsg":"ok"');
        return;
      }
      if (key === 'empty') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('');
        return;
      }
      if (key === 'servererr') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('internal error');
        return;
      }
      if (key === 'bizfail') {
        sendJson(res, 200, { errcode: 40001, errmsg: 'invalid' });
        return;
      }

      sendJson(res, 200, { errcode: 0, errmsg: 'ok' });
    })().catch((err) => {
      sendJson(res, 500, { errcode: 5000, errmsg: err?.message || 'internal error' });
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
