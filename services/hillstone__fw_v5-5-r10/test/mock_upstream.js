import http from 'node:http';

export const port = Number(process.env.HTTP_PORT || 18456);
export const expectedUser = String(process.env.HILLSTONE_USER || 'api_user');
export const expectedPassword = String(process.env.HILLSTONE_PASSWORD || 'SuperSecret!');
export const token = String(process.env.HILLSTONE_TOKEN || 'token-123');
export const role = String(process.env.HILLSTONE_ROLE || 'admin');
export const vsysId = String(process.env.HILLSTONE_VSYS_ID || '0');
export const fromrootvsys = String(process.env.HILLSTONE_FROMROOTVSYS || 'true');
export const lang = String(process.env.HILLSTONE_LANG || 'zh_CN');

const store = new Map();

const send = (res, statusCode, contentType, body) => {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

const sendJson = (res, statusCode, payload) => {
  send(res, statusCode, 'application/json', JSON.stringify(payload));
};

const readText = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });

const parseJson = async (req) => {
  const raw = await readText(req);
  if (!raw) return {};
  return JSON.parse(raw);
};

const parseCookie = (header) => {
  const out = {};
  const raw = String(header || '');
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    out[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return out;
};

const hasValidSession = (header) => {
  const cookie = parseCookie(header);
  return (
    cookie.token === token &&
    cookie.role === role &&
    String(cookie.vsysId) === vsysId &&
    cookie.fromrootvsys === fromrootvsys &&
    cookie.lang === lang
  );
};

const buildQueryPayload = (reqUrl) => {
  const raw = reqUrl.searchParams.get('query');
  if (!raw) return null;
  return JSON.parse(decodeURIComponent(raw));
};

export const createMockServer = () => http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);

  if ((reqUrl.pathname === '/' || reqUrl.pathname === '/healthz') && req.method === 'GET') {
    sendJson(res, 200, { ok: true, port });
    return;
  }

  if (reqUrl.pathname === '/rest/api/login' && req.method === 'POST') {
    try {
      const payload = await parseJson(req);
      if (
        String(payload.userName || '') !== expectedUser ||
        String(payload.password || '') !== expectedPassword ||
        String(payload.encodeUserName || '') !== '0' ||
        String(payload.encodePassword || '') !== '0' ||
        String(payload.lang || '') !== lang
      ) {
        sendJson(res, 401, { success: false, msg: 'unauthorized' });
        return;
      }
      sendJson(res, 200, {
        success: true,
        result: [{ token, role, vsysId, fromrootvsys }],
      });
    } catch (err) {
      sendJson(res, 400, { success: false, msg: 'invalid json', error: String(err.message || err) });
    }
    return;
  }

  if (reqUrl.pathname === '/rest/api/addrbook') {
    if (!hasValidSession(req.headers.cookie)) {
      sendJson(res, 401, { success: false, msg: 'missing or invalid session' });
      return;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const payload = await parseJson(req);
        const first = Array.isArray(payload) ? payload[0] : null;
        if (first && typeof first === 'object' && first.name) store.set(String(first.name), first);
        sendJson(res, 200, {
          success: true,
          operation: req.method === 'POST' ? 'add' : 'overwrite',
          result: payload,
        });
      } catch (err) {
        send(res, 400, 'text/plain', `invalid body: ${String(err.message || err)}`);
      }
      return;
    }

    if (req.method === 'GET') {
      try {
        const query = buildQueryPayload(reqUrl);
        const groupName = query?.conditions?.[0]?.value;
        const item = store.get(String(groupName || '')) || null;
        sendJson(res, 200, {
          success: true,
          query,
          result: item ? [item] : [],
        });
      } catch (err) {
        send(res, 400, 'text/plain', `invalid query: ${String(err.message || err)}`);
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
    process.stdout.write(`hillstone mock listening on :${port}\n`);
  });
}
