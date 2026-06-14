import http from 'node:http';

export const MOCK_IPS = {
  idempotent: '198.51.100.10',
  businessError: '198.51.100.11',
  forbidden: '198.51.100.12',
  serverError: '198.51.100.13',
  badJSON: '198.51.100.14',
  timeout: '198.51.100.15',
  emptySuccess: '198.51.100.16',
};

export const createMockServer = async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const writeJSON = (statusCode, body) => {
      res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'GET' || url.pathname !== '/facade/unifiedInterface.php') {
      writeJSON(404, { error: 'not found' });
      return;
    }

    const actionType = url.searchParams.get('action_type');
    const ip = url.searchParams.get('ip');
    const key = url.searchParams.get('auth_key');
    const target = url.searchParams.get('target');

    if (!key || target !== 'blackList') {
      writeJSON(400, { error: 'invalid params' });
      return;
    }
    if (ip === MOCK_IPS.timeout) return;
    if (ip === MOCK_IPS.idempotent && actionType === 'add') {
      writeJSON(200, { content: { actionErrors: ['记录已在黑名单中'] } });
      return;
    }
    if (ip === MOCK_IPS.businessError) {
      writeJSON(200, { error: 'device rejected request' });
      return;
    }
    if (ip === MOCK_IPS.forbidden) {
      writeJSON(403, { error: 'forbidden' });
      return;
    }
    if (ip === MOCK_IPS.serverError) {
      writeJSON(500, { error: 'upstream internal error' });
      return;
    }
    if (ip === MOCK_IPS.emptySuccess) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (ip === MOCK_IPS.badJSON) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{');
      return;
    }
    writeJSON(actionType === 'delete' ? 209 : 200, {
      code: 0,
      action_type: actionType,
      ip,
      target,
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
