import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';

export const USERNAME = 'admin';
export const PASSWORD = 'TopSec!123456';
export const AES_KEY_HEX = '00112233445566778899aabbccddeeff';
export const AES_IV_HEX = '0102030405060708090a0b0c0d0e0f10';

const LOGIN_PATH = '/home/restLogin/';
const ADD_PATH = '/home/default/blackWhite/whiteIpAdd/';
const DELETE_PATH = '/home/default/blackListSpread/deleteLots/';
const LOGOUT_PATH = '/home/restLogout/';

export const decryptAesZeroPadHex = (hexCipher) => {
  const key = Buffer.from(AES_KEY_HEX, 'hex');
  const iv = Buffer.from(AES_IV_HEX, 'hex');
  const decipher = crypto.createDecipheriv(`aes-${key.length * 8}-cbc`, key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(Buffer.from(hexCipher, 'hex')), decipher.final()]).toString('utf8').replace(/\u0000+$/g, '');
};

const randomToken = () => crypto.randomBytes(8).toString('hex');

const readFormBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')).entries())));
  req.on('error', reject);
});

const jsonResponse = (res, payload, status = 200, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
};

const parseCommands = (body) => {
  return JSON.parse(body.commands);
};

export function createMockServer({ allowHttp = true } = {}) {
  const tokens = new Map();
  const blacklist = new Map();
  const requests = [];

  const ensureHttps = (req, res) => {
    if (allowHttp || req.headers['x-forwarded-proto'] === 'https') return true;
    jsonResponse(res, { result: false, msg: 'HTTPS required', data: null }, 403);
    return false;
  };

  const verifySession = (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const userMark = url.searchParams.get('userMark');
    const session = tokens.get(token);
    if (!session) {
      jsonResponse(res, { result: false, msg: 'invalid token', data: null }, 403);
      return null;
    }
    if (session.userMark !== userMark) {
      jsonResponse(res, { result: false, msg: 'user_mark mismatch', data: null }, 403);
      return null;
    }
    return session;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers });

    if (req.method === 'POST' && url.pathname === LOGIN_PATH) {
      if (!ensureHttps(req, res)) return;
      const body = await readFormBody(req);
      if (body.name !== USERNAME || decryptAesZeroPadHex(body.password) !== PASSWORD || decryptAesZeroPadHex(body.ngtosAuth) !== String(PASSWORD.length)) {
        jsonResponse(res, { result: false, msg: 'invalid credentials', data: null });
        return;
      }
      const token = randomToken();
      const secret = randomToken();
      const userMark = randomToken();
      tokens.set(token, { token, secret, userMark });
      jsonResponse(res, {
        result: true,
        msg: 'login success',
        data: { authid: userMark, secret, tokens: [token] },
        tokens: [token],
        secret,
      }, 200, { 'set-cookie': `session=${token}; Path=/; HttpOnly` });
      return;
    }

    if (req.method === 'POST' && url.pathname === ADD_PATH) {
      if (!ensureHttps(req, res)) return;
      const session = verifySession(req, res);
      if (!session) return;
      const body = await readFormBody(req);
      const commands = parseCommands(body);
      const added = [];
      const existed = [];
      for (const item of commands) {
        const payload = item.blacklist_cfg_add_ip;
        if (!payload?.ipaddr) continue;
        if (blacklist.has(payload.ipaddr)) existed.push({ ip: payload.ipaddr, reason: 'already exists', code: 'E_DUP' });
        else {
          blacklist.set(payload.ipaddr, payload);
          added.push(payload.ipaddr);
        }
      }
      jsonResponse(res, { result: true, msg: added.length ? 'success' : 'already exists', data: { success_ips: added, fail_ips: existed } });
      return;
    }

    if (req.method === 'POST' && url.pathname === DELETE_PATH) {
      if (!ensureHttps(req, res)) return;
      const session = verifySession(req, res);
      if (!session) return;
      const body = await readFormBody(req);
      const commands = parseCommands(body);
      const removed = [];
      const missing = [];
      for (const item of commands) {
        const payload = item.blacklist_cfg_delete_ip;
        if (!payload?.ipaddr) continue;
        if (blacklist.has(payload.ipaddr)) {
          blacklist.delete(payload.ipaddr);
          removed.push(payload.ipaddr);
        } else missing.push({ ip: payload.ipaddr, reason: 'not found', code: 'E_MISSING' });
      }
      jsonResponse(res, { result: true, msg: removed.length ? 'success' : 'not found', data: { success_ips: removed, fail_ips: missing } });
      return;
    }

    if (req.method === 'GET' && url.pathname === LOGOUT_PATH) {
      if (!ensureHttps(req, res)) return;
      const session = verifySession(req, res);
      if (!session) return;
      tokens.delete(session.token);
      jsonResponse(res, { result: true, msg: 'logout success', data: null });
      return;
    }

    jsonResponse(res, { result: false, msg: 'not found', data: null }, 404);
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
