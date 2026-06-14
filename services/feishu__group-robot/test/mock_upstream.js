import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18080);
const log = (...args) => console.log('[mock-feishu-grouprobot]', ...args);

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/open-apis/bot/v2/hook/test-token') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString();
      let body;
      try {
        body = bodyRaw ? JSON.parse(bodyRaw) : {};
      } catch {
        sendJson(res, 400, { StatusCode: 400, StatusMessage: 'Invalid JSON' });
        return;
      }
      if (!String(req.headers['content-type'] || '').includes('application/json')) {
        sendJson(res, 400, { StatusCode: 400, StatusMessage: 'Content-Type must be application/json' });
        return;
      }
      if (body.msg_type !== 'text') {
        sendJson(res, 400, { StatusCode: 400, StatusMessage: 'msg_type must be text' });
        return;
      }
      if (!body.content || typeof body.content.text !== 'string') {
        sendJson(res, 400, { StatusCode: 400, StatusMessage: 'content.text is required' });
        return;
      }
      sendJson(res, 200, { StatusCode: 0, StatusMessage: 'success' });
      log('sent message:', body.content.text);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/open-apis/bot/v2/hook/test-209') {
    sendJson(res, 209, { StatusCode: 0, StatusMessage: 'success with 209' });
    return;
  }
  if (req.method === 'POST' && req.url === '/open-apis/bot/v2/hook/test-210') {
    sendJson(res, 210, { StatusCode: 0, StatusMessage: 'success with 210' });
    return;
  }
  if (req.method === 'POST' && req.url === '/open-apis/bot/v2/hook/test-400') {
    sendJson(res, 400, { StatusCode: 400, StatusMessage: 'Bad Request' });
    return;
  }
  if (req.method === 'POST' && req.url === '/open-apis/bot/v2/hook/test-401') {
    sendJson(res, 401, { StatusCode: 401, StatusMessage: 'Unauthorized' });
    return;
  }
  if (req.method === 'POST' && req.url === '/open-apis/bot/v2/hook/test-business-error') {
    sendJson(res, 200, { StatusCode: 10003, StatusMessage: 'token is invalid' });
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () => {
  log(`listening on :${httpPort} (POST /open-apis/bot/v2/hook/*)`);
});
