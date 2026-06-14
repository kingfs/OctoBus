import http from 'node:http';

export const createMockServer = (handler) => {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const result = await handler(req, body);
    res.statusCode = result?.status ?? 200;
    for (const [key, value] of Object.entries(result?.headers ?? { 'content-type': 'application/json' })) {
      res.setHeader(key, value);
    }
    res.end(result?.body ?? '{"success":true}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
