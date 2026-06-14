/* node:coverage disable */
import http from 'node:http';

export const createMockServer = async () => {
  const requests = [];
  const preciseBlacklist = new Map();
  const globalBlacklist = new Map();

  const sendJson = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });

  const server = http.createServer((req, res) => {
    (async () => {
      const rawBody = await readBody(req);
      let body = {};
      try {
        body = rawBody.trim() ? JSON.parse(rawBody) : {};
      } catch {
        sendJson(res, 400, { error: 'invalid json body' });
        return;
      }
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });

      if (!body.action) {
        sendJson(res, 400, { error: 'action is required' });
        return;
      }
      if (!body.signature) {
        sendJson(res, 401, { error: 'signature is required' });
        return;
      }
      if (!body.secret_id) {
        sendJson(res, 400, { error: 'secret_id is required' });
        return;
      }

      if (body.action === 'v1/add_precise_black') {
        const rule = body.rules?.[0] || {};
        const key = `${rule.field}:${rule.content}:${rule.operator}`;
        preciseBlacklist.set(key, { rule, threshold: body.threshold });
        sendJson(res, 200, { err: null, msg: 'ok', data: { added: true } });
        return;
      }

      if (body.action === 'v1/del_precise_black') {
        const rule = body.rules?.[0] || {};
        const key = `${rule.field}:${rule.content}:${rule.operator}`;
        const removed = preciseBlacklist.delete(key);
        sendJson(res, 200, { err: null, msg: 'ok', data: { removed } });
        return;
      }

      if (body.action === 'v1/add_global_black') {
        const key = `${body.ip_src}:${body.ip_dst || ''}`;
        globalBlacklist.set(key, { ip_src: body.ip_src, ip_dst: body.ip_dst || '' });
        sendJson(res, 200, { status_code: 200, err: null, msg: 'ok', data: { added: true } });
        return;
      }

      if (body.action === 'v1/del_global_black') {
        const key = `${body.ip_src}:${body.ip_dst || ''}`;
        const removed = globalBlacklist.delete(key);
        const statusCode = removed ? 200 : 210;
        sendJson(res, 200, { status_code: statusCode, err: null, msg: statusCode === 210 ? 'already unblocked' : 'ok', data: { removed } });
        return;
      }

      sendJson(res, 400, { error: 'unknown action' });
    })().catch((err) => {
      sendJson(res, 500, { error: err?.message || 'internal error' });
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
