import http from 'node:http';

export const createMockServer = async ({ user = 'sys_user', password = 'Passw0rd!' } = {}) => {
  const expectedAuth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });

    if (req.method !== 'PUT' || !req.url.startsWith('/restconf/data/huawei-address-set:address-set/addr-group=')) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (req.headers.authorization !== expectedAuth) {
      res.writeHead(401, { 'content-type': 'application/yang-data+xml' });
      res.end('<error>unauthorized</error>');
      return;
    }
    if ((req.headers['x-simulate-status'] || '') === '500') {
      res.writeHead(500, { 'content-type': 'application/yang-data+xml' });
      res.end('<error>internal failure</error>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/yang-data+xml' });
    res.end(`<result><updated>true</updated><length>${body.length}</length></result>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
