import http from 'node:http';

export const port = Number(process.env.HTTP_PORT || 18082);
export const username = process.env.MOCK_USERNAME || 'api_user';
export const password = process.env.MOCK_PASSWORD || 'SuperSecret';

const encode = (value) => Buffer.from(value).toString('base64');
export const expectedAuthorization = encode(`${username}:${password}`);

const books = new Map();
let nextId = 1000;

const sendJSON = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const sendText = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

const getBook = (name) => {
  if (!books.has(name)) books.set(name, []);
  return books.get(name);
};

const parseBookName = (pathname) => {
  const match = pathname.match(/\/api\/v1\.0\/WebProtection\/Access\/IPList\/([^/]+)\/IPListCreateIPListPolicyMember(?:\/(\d+))?$/);
  if (!match) return null;
  return {
    bookName: decodeURIComponent(match[1]),
    memberId: match[2] ? Number(match[2]) : null,
  };
};

export const createMockServer = () => http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.headers.authorization !== expectedAuthorization) {
    sendJSON(res, 401, { status: 0, msg: 'Unauthorized' });
    return;
  }

  if (url.pathname === '/api/v1.0/System/Status/Online') {
    if (req.headers['x-mock-online-status'] === 'down') {
      sendJSON(res, 200, { status: 0, msg: 'Offline', version: 'FWB 6.2.1' });
      return;
    }
    if (req.headers['x-mock-mode'] === 'text') {
      sendText(res, 200, 'not-json');
      return;
    }
    sendJSON(res, 200, { status: 1, msg: 'Online', version: 'FWB 6.2.1' });
    return;
  }

  const parsed = parseBookName(url.pathname);
  if (!parsed) {
    sendJSON(res, 404, { status: 0, msg: 'Not Found' });
    return;
  }

  const list = getBook(parsed.bookName);

  if (req.method === 'POST' && parsed.memberId === null) {
    const raw = await readBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const member = {
      id: nextId++,
      type: Number(payload.type || 2),
      iPv4IPv6: String(payload.iPv4IPv6 || ''),
      severity: Number(payload.severity || 2),
      triggerPolicy: String(payload.triggerPolicy || ''),
      status: 0,
    };
    list.push(member);
    sendJSON(res, 200, { status: 0, affected: 1, msg: 'OK' });
    return;
  }

  if (req.method === 'GET' && parsed.memberId === null) {
    sendJSON(res, 200, list);
    return;
  }

  if (req.method === 'DELETE' && parsed.memberId !== null) {
    const index = list.findIndex((item) => item.id === parsed.memberId);
    if (index === -1) {
      sendJSON(res, 200, { status: 0, affected: 0, msg: 'Not found' });
      return;
    }
    list.splice(index, 1);
    sendJSON(res, 200, { status: 0, affected: 1, msg: 'Deleted' });
    return;
  }

  sendJSON(res, 405, { status: 0, msg: 'Method Not Allowed' });
});

if (process.argv[1] != null && import.meta.url === new URL(process.argv[1], 'file:').href) {
  createMockServer().listen(port, '0.0.0.0', () => {
    console.log(`[Fortinet_WAF mock] listening on ${port}`);
  });
}
