import http from 'node:http';

export const port = Number(process.env.HTTP_PORT || 18455);
export const expectedUser = String(process.env.HILLSTONE_USER || 'hillstone-admin');
export const expectedPassword = String(process.env.HILLSTONE_PASSWORD || 'c2VjcmV0');
export const token = String(process.env.HILLSTONE_TOKEN || 'token-123');
export const role = String(process.env.HILLSTONE_ROLE || 'admin');
export const vsysId = String(process.env.HILLSTONE_VSYS_ID || '0');
export const username = String(process.env.HILLSTONE_USERNAME || 'hillstone');
export const lang = String(process.env.HILLSTONE_LANG || 'zh_CN');

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

const parseQueryPayload = (value) => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const hasValidToken = (cookieHeader) => String(cookieHeader || '').includes(`token=${token}`);

export const createMockServer = () => http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);

  if ((reqUrl.pathname === '/' || reqUrl.pathname === '/healthz') && req.method === 'GET') {
    sendJson(res, 200, { ok: true, port });
    return;
  }

  if (reqUrl.pathname === '/rest/doc/login') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, msg: 'method not allowed' });
      return;
    }
    try {
      const payload = await readJson(req);
      if (String(payload.userName || '') !== expectedUser || String(payload.password || '') !== expectedPassword) {
        sendJson(res, 401, { success: false, msg: 'unauthorized' });
        return;
      }
      sendJson(res, 200, {
        success: true,
        msg: 'ok',
        token,
        role,
        vsysId,
        username,
        lang,
      });
    } catch {
      sendJson(res, 400, { success: false, msg: 'invalid json' });
    }
    return;
  }

  if (reqUrl.pathname === '/rest/doc/addrbook') {
    if (!hasValidToken(req.headers.cookie)) {
      sendJson(res, 401, { success: false, msg: 'missing token' });
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, {
        success: true,
        operation: 'query',
        query: parseQueryPayload(reqUrl.searchParams.get('query')),
      });
      return;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const payload = await readJson(req);
        sendJson(res, 200, {
          success: true,
          operation: req.method === 'POST' ? 'create' : 'update',
          body: payload,
        });
      } catch {
        sendJson(res, 400, { success: false, msg: 'invalid body' });
      }
      return;
    }

    sendJson(res, 405, { success: false, msg: 'method not allowed' });
    return;
  }

  sendJson(res, 404, { success: false, msg: 'not found' });
});

if (process.argv[1] != null && import.meta.url === new URL(process.argv[1], 'file:').href) {
  createMockServer().listen(port, '0.0.0.0', () => {
    process.stdout.write(`hillstone v55r4 mock listening on :${port}\n`);
  });
}
