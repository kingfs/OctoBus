/* node:coverage disable */
import http from 'node:http';

export const createMockServer = async () => {
  const requests = [];

  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });

    if (req.method !== 'GET' || url.pathname !== '/tip_api/v4/ip') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }

    const apikey = url.searchParams.get('apikey');
    const resource = url.searchParams.get('resource');
    if (!apikey) {
      sendJson(res, 401, { response_code: -1, verbose_msg: 'Missing apikey' });
      return;
    }
    if (apikey === 'invalid_key') {
      sendJson(res, 403, { response_code: -1, verbose_msg: 'Invalid apikey' });
      return;
    }
    if (!resource) {
      sendJson(res, 400, { response_code: -1, verbose_msg: 'Missing resource' });
      return;
    }
    if (resource === '500.500.500.500') {
      sendJson(res, 500, { response_code: -1, verbose_msg: 'Internal server error' });
      return;
    }
    if (resource === '1.1.1.1') {
      sendJson(res, 200, { response_code: 1001, verbose_msg: 'IP not found in database', data: [] });
      return;
    }

    sendJson(res, 200, {
      response_code: 0,
      verbose_msg: 'Ok',
      data: [{
        intelligence: [{
          severity: 'malicious',
          judgments: ['Botnet', 'C2'],
        }],
        resource,
      }],
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
