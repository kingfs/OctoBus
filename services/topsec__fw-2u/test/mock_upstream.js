import http from 'node:http';
import { URL } from 'node:url';

export const encodePayload = (payload, token = '') => `${token ? `?${token}` : ''}${Buffer.from(JSON.stringify(payload)).toString('base64')}`;

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks).toString()));
});

const send = (res, statusCode, body, headers = {}) => {
  const text = String(body);
  res.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
};

export function createMockServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body, form });

    if (req.method === 'POST' && url.pathname === '/home/login/addNoCode/') {
      send(
        res,
        200,
        encodePayload({ result: true, data: { authid: `mark-${form.get('name') || 'demo'}` }, tokens: ['fallback-token'], secret: 'demo-secret' }, '1234567890abcdef'),
        { 'set-cookie': ['PHPSESSID=demo-session; Path=/', 'changeVsid=0; Path=/'] },
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/home/index/') {
      send(res, 500, 'server busy');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/home/default/blackListSpread/addTuple/') {
      send(res, 200, encodePayload({ result: true, data: form.get('commands[0][pf_blacklist_add_tuple][0][tuple]') || 'success' }, 'fedcba0987654321'));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/home/default/blackListSpread/deleteLots/') {
      const deleted = [];
      for (const [key, value] of form.entries()) {
        if (key.includes('[pf_blacklist_delete]') && key.endsWith('[sip]')) deleted.push(value);
      }
      send(res, 200, encodePayload({ result: true, data: deleted }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/home/index/logout/') {
      send(res, 200, encodePayload({ result: true, data: 'logout success' }));
      return;
    }

    send(res, 404, 'not found');
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
