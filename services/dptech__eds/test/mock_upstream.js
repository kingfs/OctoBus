import http from 'node:http';
import { randomUUID } from 'node:crypto';

const HTTP_PORT = Number(process.env.HTTP_PORT || 19090);
const PATH_V4 = '/func/web_main/api/maf/maf_addrfilter/maf_addrfilter/mafcustomv4wblist';
const PATH_V6 = '/func/web_main/api/maf/maf_addrfilter/maf_addrfilter/mafcustomv6wblist';
const EXPECTED_USER = process.env.MOCK_USER || 'eds-user';
const EXPECTED_PASS = process.env.MOCK_PASSWORD || 'eds-pass';
const FAIL_IPS = new Set((process.env.FAIL_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean));

const state = {
  ipv4: new Set(),
  ipv6: new Set(),
};

const log = (...args) => console.log('[dptech-mock]', ...args);

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!raw.trim()) {
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

const parseBasicAuth = (header) => {
  if (!header || !header.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return { user: decoded, password: '' };
    return { user: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
};

const shouldFailIp = (ip) => FAIL_IPS.has(ip);

const handleSimulationHeader = (req, res) => {
  const flag = (req.headers['x-dptech-simulate'] || '').toString().toLowerCase();
  if (!flag) return false;
  if (flag === 'http-500') {
    sendJson(res, 500, { msg: 'simulated 500', data: null, request_id: randomUUID() });
    return true;
  }
  if (flag === 'error-field') {
    sendJson(res, 200, { error: 'simulated-error', msg: 'mock error', data: null });
    return true;
  }
  return false;
};

const handleBlock = (res, family, body) => {
  const nodeName = family === 'ipv4' ? 'mafcustomv4wblist' : 'mafcustomv6wblist';
  const payload = body?.[nodeName];
  const group = payload?.GroupStr || 'default-group';
  const ip = family === 'ipv4' ? payload?.IPStart : payload?.IP;
  if (!ip) {
    sendJson(res, 400, { error: 'IP missing', msg: 'IP is required', data: null });
    return;
  }
  if (shouldFailIp(ip)) {
    sendJson(res, 200, { error: 'mock-failure', msg: 'simulated fail', data: null });
    return;
  }
  const store = family === 'ipv4' ? state.ipv4 : state.ipv6;
  store.add(ip);
  sendJson(res, 200, { msg: 'ok', data: { group, ip, family }, request_id: randomUUID() });
};

const handleDelete = (res, family, body) => {
  const nodeName = family === 'ipv4' ? 'mafcustomv4wblist' : 'mafcustomv6wblist';
  const payload = body?.[nodeName];
  const ip = family === 'ipv4' ? payload?.IPaddr : payload?.IP;
  if (!ip) {
    sendJson(res, 400, { error: 'IP missing', msg: 'IP is required', data: null });
    return;
  }
  const store = family === 'ipv4' ? state.ipv4 : state.ipv6;
  if (shouldFailIp(ip)) {
    sendJson(res, 200, { error: 'mock-failure', msg: 'simulated fail', data: null });
    return;
  }
  if (!store.has(ip)) {
    sendJson(res, 200, { msg: '条目不存在', data: null });
    return;
  }
  store.delete(ip);
  sendJson(res, 200, { msg: 'ok', data: { ip, removed: true } });
};

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`).pathname;
  if (![PATH_V4, PATH_V6].includes(path)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  if (handleSimulationHeader(req, res)) return;
  const auth = parseBasicAuth(req.headers.authorization);
  if (!auth || auth.user !== EXPECTED_USER || auth.password !== EXPECTED_PASS) {
    sendJson(res, 401, { error: 'unauthorized', msg: 'invalid credentials', data: null });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err?.message || 'invalid json', data: null });
    return;
  }

  if (path === PATH_V4) {
    if (req.method === 'POST') return handleBlock(res, 'ipv4', body);
    if (req.method === 'DELETE') return handleDelete(res, 'ipv4', body);
  }
  if (path === PATH_V6) {
    if (req.method === 'POST') return handleBlock(res, 'ipv6', body);
    if (req.method === 'DELETE') return handleDelete(res, 'ipv6', body);
  }
  sendJson(res, 405, { error: 'method not allowed', data: null });
});

server.listen(HTTP_PORT, () => {
  log(`listening on http://127.0.0.1:${HTTP_PORT}`);
  log('paths:', PATH_V4, PATH_V6);
});
