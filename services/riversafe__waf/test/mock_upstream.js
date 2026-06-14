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

  const sendJson = (res, payload, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/api/v1/ip_black_list' || req.method !== 'POST') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }

      const rawBody = await readBody(req);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: rawBody });
      let body;
      try {
        body = rawBody.trim() ? JSON.parse(rawBody) : {};
      } catch {
        sendJson(res, { err_no: 10001, err_msg: 'invalid json' });
        return;
      }

      if (!Array.isArray(body.items)) {
        sendJson(res, { err_no: 10002, err_msg: 'items required' });
        return;
      }

      const simulate = String(url.searchParams.get('simulate') || req.headers['x-mock-simulate'] || '').trim().toUpperCase();
      if (simulate === 'HTTP-500') {
        sendJson(res, { err_no: 1, err_msg: 'server error' }, 500);
        return;
      }
      if (simulate === 'BIZ-ERROR') {
        sendJson(res, { err_no: 123, err_msg: 'biz error' });
        return;
      }
      if (simulate === 'EMPTY') {
        res.writeHead(204);
        res.end('');
        return;
      }
      if (simulate === 'INVALID-JSON') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('not json');
        return;
      }
      if (simulate === 'MISSING-ERR-NO') {
        sendJson(res, { err_msg: 'missing err_no' });
        return;
      }

      sendJson(res, { err_no: 0, err_msg: 'ok' });
    })().catch((err) => {
      sendJson(res, { err_no: 500, err_msg: err?.message || 'internal error' }, 500);
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
