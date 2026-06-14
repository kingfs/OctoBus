import http from 'node:http';

const port = Number(process.env.MOCK_PORT || 18843);

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const send = (res, status, payload, headers = {}) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...headers,
  });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const json = body ? JSON.parse(body) : {};

  if (req.method === 'POST' && req.url === '/UMC/restful/token/getRestfulInterfaceToken') {
    return send(res, 200, {
      code: 0,
      token: 'mock-token',
      expireTime: '2099-12-31 23:59:59',
    });
  }

  if (req.method === 'POST' && req.url === '/UMC/restful/api/getBlackAndWhiteListStrategy') {
    if (req.headers.token !== 'mock-token') {
      return send(res, 401, { code: 401, message: 'invalid token' });
    }
    return send(res, 200, {
      code: 0,
      details: [
        {
          strategyName: json.strategyName || 'ip_name_203_0_113_10',
          ipSegments: [json.ip || '203.0.113.10'],
          action: 2,
          survivalTime: 'permanent',
        },
      ],
    });
  }

  if (req.method === 'POST' && req.url === '/UMC/restful/api/blackAndWhiteListStrategyConfig') {
    if (req.headers.token !== 'mock-token') {
      return send(res, 401, { code: 401, message: 'invalid token' });
    }
    if (json.operationType === 1 || json.operationType === 3) {
      return send(res, 200, { code: 0, message: 'success' });
    }
    return send(res, 400, { code: 400, message: 'unsupported operationType' });
  }

  return send(res, 404, { code: 404, message: 'not found' });
});

server.listen(port, () => {
  console.log(`DPtech_UMC_ADS_v5329 mock listening on http://127.0.0.1:${port}`);
});
