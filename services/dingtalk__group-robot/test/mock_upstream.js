import http from 'node:http';
import { URL } from 'node:url';

const HTTP_PORT = Number(process.env.HTTP_PORT || 19091);
const FAIL_RATE = Number(process.env.FAIL_RATE || 0);
const VERBOSE = process.env.LOG_VERBOSE === '1';

const log = (...args) => console.log('[dingding-mock]', ...args);

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('payload too large'));
      }
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

const validateSignature = (reqUrl) => {
  const url = new URL(reqUrl, `http://localhost:${HTTP_PORT}`);
  return {
    hasTimestamp: Boolean(url.searchParams.get('timestamp')),
    hasSign: Boolean(url.searchParams.get('sign')),
    hasAccessToken: Boolean(url.searchParams.get('access_token')),
    accessToken: url.searchParams.get('access_token'),
  };
};

const shouldInjectError = () => FAIL_RATE > 0 && Math.random() * 100 < FAIL_RATE;

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`).pathname;
  if (!path.includes('/robot/send')) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { errcode: 400, errmsg: 'invalid json' });
    return;
  }

  const sigInfo = validateSignature(req.url);
  if (VERBOSE) {
    log('request', { method: req.method, path, signature: sigInfo, body });
  }

  if (!sigInfo.hasAccessToken) {
    sendJson(res, 400, { errcode: 310000, errmsg: 'missing access_token' });
    return;
  }
  if (shouldInjectError()) {
    sendJson(res, 500, { errcode: 500, errmsg: 'simulated server error' });
    return;
  }
  if (sigInfo.accessToken === 'invalid-token') {
    sendJson(res, 401, { errcode: 401, errmsg: 'invalid access_token' });
    return;
  }
  if (body.msgtype !== 'text') {
    sendJson(res, 400, { errcode: 400001, errmsg: 'unsupported msgtype' });
    return;
  }
  if (!body.text?.content) {
    sendJson(res, 400, { errcode: 400002, errmsg: 'empty content' });
    return;
  }
  if (sigInfo.accessToken === 'rate-limited-token') {
    sendJson(res, 200, { errcode: 90030, errmsg: 'rate limited' });
    return;
  }

  sendJson(res, 200, { errcode: 0, errmsg: 'ok' });
});

server.listen(HTTP_PORT, () => {
  log(`listening on http://127.0.0.1:${HTTP_PORT}`);
  log('fail rate:', FAIL_RATE);
});
