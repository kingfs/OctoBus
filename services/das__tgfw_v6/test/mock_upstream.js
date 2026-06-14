import http from 'node:http';

const port = Number(process.env.HTTP_PORT || 18081);
const okToken = String(process.env.API_TOKEN || 'Token');

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

const sendJson = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/api/v1/blacklist') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }

  const token = String(req.headers.authorizationtoken || '');
  if (!token || token !== okToken) {
    sendJson(res, 401, { msg: 'unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    const sAddr = url.searchParams.get('s_addr') || '';
    const isIp6 = url.searchParams.get('is_ip6');
    if (sAddr === '203.0.113.100') {
      sendJson(res, 200, { msg: 'success', vals: [] });
      return;
    }
    if (sAddr === '203.0.113.101') {
      sendJson(res, 400, { msg: 'bad request' });
      return;
    }
    if (sAddr === '203.0.113.102') {
      sendJson(res, 500, { msg: 'server error' });
      return;
    }
    sendJson(res, 200, {
      msg: 'success',
      vals: [
        {
          id: 321,
          s_addr: sAddr || (isIp6 === 'true' ? '2001:db8::10' : '1.1.1.1'),
          enable: true,
          lifespan: 60,
        },
      ],
    });
    return;
  }

  if (req.method === 'POST') {
    const raw = await readBody(req);
    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      sendJson(res, 400, { msg: 'invalid json' });
      return;
    }

    if (parsed?.val?.s_addr === '203.0.113.104') {
      sendJson(res, 400, { msg: 'bad request' });
      return;
    }
    if (parsed?.val?.s_addr === '203.0.113.105') {
      sendJson(res, 500, { msg: 'server error' });
      return;
    }
    if (parsed?.val?.s_addr === '203.0.113.103') {
      sendJson(res, 200, { msg: 'failed' });
      return;
    }
    if (parsed?.val?.s_addr === '203.0.113.106') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('');
      return;
    }

    sendJson(res, 200, { msg: 'success' });
    return;
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (id === '400') {
      sendJson(res, 400, { msg: 'bad request' });
      return;
    }
    if (id === '500') {
      sendJson(res, 500, { msg: 'server error' });
      return;
    }
    if (id === '200') {
      sendJson(res, 200, { msg: 'failed' });
      return;
    }
    sendJson(res, 200, { msg: 'success' });
    return;
  }

  res.writeHead(405, { 'content-type': 'text/plain' });
  res.end('method not allowed');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[mock-upstream] listening on :${port}, ok token=${okToken}`);
});
