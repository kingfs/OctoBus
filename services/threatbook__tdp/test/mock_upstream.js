/* node:coverage disable */
import http from 'node:http';

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk.toString();
  });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch {
      resolve({});
    }
  });
  req.on('error', reject);
});

export const createMockServer = async ({ apiKey = 'test_api_key' } = {}) => {
  const requests = [];

  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method !== 'POST' || url.pathname !== '/api/v1/linkage_block/deny_list/operate') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const requestApiKey = url.searchParams.get('api_key');
      const authTimestamp = url.searchParams.get('auth_timestamp');
      const sign = url.searchParams.get('sign');
      if (!requestApiKey || !authTimestamp || !sign) {
        sendJson(res, 401, { response_code: -1, response_message: 'Missing auth params' });
        return;
      }
      if (requestApiKey !== apiKey) {
        sendJson(res, 403, { response_code: -1, response_message: 'Invalid API Key' });
        return;
      }
      const body = await readBody(req);
      requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
      if (body.ioc_list?.includes('500.com')) {
        sendJson(res, 500, { error: 'Internal Server Error' });
        return;
      }
      if (body.ioc_list?.includes('400.com')) {
        sendJson(res, 400, { response_code: -1, response_message: 'Bad Request' });
        return;
      }
      if (body.ioc_list?.includes('badjson.com')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('NOT_A_JSON!');
        return;
      }
      if (body.ioc_list?.includes('empty.com')) {
        res.writeHead(204);
        res.end('');
        return;
      }
      sendJson(res, 200, {
        response_code: 0,
        response_message: 'Success',
        data: {
          operated_count: Array.isArray(body.ioc_list) ? body.ioc_list.length : 0,
          operate: body.operate,
        },
      });
    })().catch((err) => sendJson(res, 500, { error: err?.message || 'internal error' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
