/* node:coverage disable */
import http from 'node:http';

const LOGIN_PATH = '/api/sky-platform/auth/user/login';
const ENV_PATH = '/api/sky-policyinsight/blocker/v2/environment/getAll';
const WORK_ORDER_PATH = '/api/sky-policyinsight/blocker/v2';

export const createMockServer = async (options = {}) => {
  const requests = [];
  const accessToken = options.accessToken || 'mock-token';
  const username = options.username || 'user';
  const password = options.password || 'secret';
  const environments = options.environments || [{ id: 'env-prod', name: 'prod' }];
  let workOrderSeq = 1;

  const readBody = (req) => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });

  const sendJson = (res, payload, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  const parseBody = async (req) => {
    const raw = await readBody(req);
    return raw.trim() ? JSON.parse(raw) : {};
  };

  const hasValidCookie = (req) => String(req.headers.cookie || '').includes(`access_token=${accessToken}`);

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method !== 'POST') {
        sendJson(res, { code: 404, message: 'only POST supported', path: url.pathname }, 404);
        return;
      }
      if (url.pathname === LOGIN_PATH) {
        const body = await parseBody(req);
        requests.push({ stage: 'login', method: req.method, url: req.url, headers: req.headers, body });
        if (options.failLogin || body.username !== username || body.password !== password) {
          sendJson(res, { code: 401, data: null, message: 'invalid credentials' });
          return;
        }
        sendJson(res, { code: 200, data: { access_token: accessToken }, message: 'login success' });
        return;
      }
      if (url.pathname === ENV_PATH) {
        const body = await parseBody(req);
        requests.push({ stage: 'environment', method: req.method, url: req.url, headers: req.headers, body });
        if (!hasValidCookie(req)) {
          sendJson(res, { code: 401, data: null, message: 'missing token' });
          return;
        }
        const name = String(body.name || '').trim();
        sendJson(res, { code: 200, data: name ? environments.filter((env) => env.name === name) : environments });
        return;
      }
      if (url.pathname === WORK_ORDER_PATH) {
        const body = await parseBody(req);
        requests.push({ stage: 'work-order', method: req.method, url: req.url, headers: req.headers, body });
        if (!hasValidCookie(req)) {
          sendJson(res, { code: 401, data: null, message: 'missing token' });
          return;
        }
        if (options.failWorkOrder) {
          sendJson(res, { code: 500, data: null, message: 'forced work order failure' });
          return;
        }
        sendJson(res, {
          code: 200,
          data: {
            id: `WO-${workOrderSeq++}`,
            environmentId: body.environmentId,
            type: body.type,
          },
          message: 'work order created',
        });
        return;
      }
      sendJson(res, { code: 404, message: 'unknown path', path: url.pathname }, 404);
    })().catch((err) => {
      sendJson(res, { code: 500, message: err?.message || 'internal error' }, 500);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
