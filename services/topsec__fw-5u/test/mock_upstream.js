import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';

export const USERNAME = 'admin';
export const PASSWORD = 'TopSec!123456';

export const encodeTokenPayload = (token, decoded) => `?${token}---${Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64')}`;

const randomToken = () => crypto.randomBytes(8).toString('hex');

export const decryptQuotedCipher = (quotedCipher) => {
  const cipherText = String(quotedCipher || '').replace(/^'/, '').replace(/'$/, '');
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from('1111111111111111'), Buffer.from('1111111111111111'));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8').replace(/\u0000+$/g, '');
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const parseForm = async (req) => {
  const raw = await readBody(req);
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
};

const respond = (res, status, headers, body) => {
  res.writeHead(status, headers);
  res.end(body);
};

export function createMockServer({ allowHttp = true } = {}) {
  const sessions = new Map();
  const blacklist = new Set();
  const requests = [];

  const denyPlainHttpIfNeeded = (req, res) => {
    if (allowHttp || req.headers['x-forwarded-proto'] === 'https') return false;
    respond(res, 403, { 'content-type': 'text/plain' }, 'HTTPS required');
    return true;
  };

  const getSession = (token, userMark) => {
    const session = sessions.get(token);
    if (!session || session.userMark !== userMark) return null;
    return session;
  };

  const rotateToken = (session) => {
    sessions.delete(session.token);
    session.token = randomToken();
    sessions.set(session.token, session);
    return session.token;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers });

    if (req.method === 'POST' && url.pathname === '/home/login/') {
      if (denyPlainHttpIfNeeded(req, res)) return;
      const form = await parseForm(req);
      if (String(form.name).trim() !== USERNAME || decryptQuotedCipher(form.password) !== PASSWORD || String(form.pwdlen) !== String(PASSWORD.length)) {
        respond(res, 200, { 'content-type': 'text/plain' }, encodeTokenPayload(randomToken(), { result: false, data: { message: 'invalid credentials' } }));
        return;
      }
      const token = randomToken();
      const userMark = randomToken() + randomToken();
      sessions.set(token, { token, userMark });
      respond(res, 200, {
        'content-type': 'text/plain',
        'set-cookie': [`PHPSESSID=${token}; Path=/`, 'changeVsid=default; Path=/', `username=${USERNAME}; Path=/`],
      }, encodeTokenPayload(token, { result: true, data: { authid: userMark, message: 'login success' } }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/home/index/') {
      if (denyPlainHttpIfNeeded(req, res)) return;
      const userMark = url.searchParams.get('userMark');
      const token = String(req.headers.cookie).match(/PHPSESSID=([^;]+)/)?.[1] || '';
      const session = getSession(token, userMark);
      if (!session) {
        respond(res, 403, { 'content-type': 'text/plain' }, 'invalid session');
        return;
      }
      respond(res, 200, { 'content-type': 'text/plain' }, encodeTokenPayload(rotateToken(session), { result: true, data: { message: 'refresh success' } }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/home/default/blackListSpread/addTuple/') {
      if (denyPlainHttpIfNeeded(req, res)) return;
      const userMark = url.searchParams.get('userMark');
      const form = await parseForm(req);
      const session = getSession(String(form.token), userMark);
      if (!session) {
        respond(res, 403, { 'content-type': 'text/plain' }, 'invalid token');
        return;
      }
      const ip = String(form['commands[0][pf_blacklist_add_tuple][0][tuple]']).split(',')[0].trim();
      const token = rotateToken(session);
      if (blacklist.has(ip)) {
        respond(res, 200, { 'content-type': 'text/plain' }, encodeTokenPayload(token, { result: false, data: '黑名单条目已存在' }));
        return;
      }
      blacklist.add(ip);
      respond(res, 200, { 'content-type': 'text/plain' }, encodeTokenPayload(token, { result: true, data: 'success' }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/home/default/blackListSpread/deleteLots/') {
      if (denyPlainHttpIfNeeded(req, res)) return;
      const userMark = url.searchParams.get('userMark');
      const form = await parseForm(req);
      const session = getSession(String(form.token), userMark);
      if (!session) {
        respond(res, 403, { 'content-type': 'text/plain' }, 'invalid token');
        return;
      }
      const ip = String(form['commands[0][pf_blacklist_delete][0][sip]']).trim();
      const token = rotateToken(session);
      if (!blacklist.has(ip)) {
        respond(res, 200, { 'content-type': 'text/plain' }, encodeTokenPayload(token, { result: false, data: '黑名单索引不存在' }));
        return;
      }
      blacklist.delete(ip);
      respond(res, 200, { 'content-type': 'text/plain' }, encodeTokenPayload(token, { result: true, data: 'success' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/home/index/logout/') {
      if (denyPlainHttpIfNeeded(req, res)) return;
      const token = url.searchParams.get('token');
      const userMark = url.searchParams.get('userMark');
      const session = getSession(token, userMark);
      if (!session) {
        respond(res, 200, { 'content-type': 'text/plain' }, encodeTokenPayload(token, { result: false, data: { message: 'invalid session' } }));
        return;
      }
      sessions.delete(token);
      respond(res, 200, { 'content-type': 'text/plain' }, encodeTokenPayload(randomToken(), { result: true, data: { message: 'logout success' } }));
      return;
    }

    respond(res, 404, { 'content-type': 'text/plain' }, 'not found');
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
