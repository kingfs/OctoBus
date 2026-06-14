import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18081);
const log = (...args) => console.log('[mock-das-v3]', ...args);

const blacklist = new Set();

const server = http.createServer((req, res) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 0, msg: 'Unauthorized' }));
    return;
  }

  const credentials = auth.split(' ')[1];
  if (credentials !== 'dXNlcjpwYXNzd29yZA==') {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 0, msg: 'Forbidden' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/v3/Objects/Blacklist') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString();
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const entries = body.blist_entry || [];

      let alreadyExists = false;
      for (const entry of entries) {
        if (blacklist.has(entry.blist)) {
          alreadyExists = true;
        }
        blacklist.add(entry.blist);
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 1, msg: alreadyExists && entries.length === 1 ? '该记录已存在' : 'success' }));
      log('Blocked IPs:', entries.map((entry) => entry.blist));
    });
    return;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/v3/Objects/Blacklist/blist/')) {
    const ip = decodeURIComponent(req.url.split('/').pop());
    if (blacklist.has(ip)) {
      blacklist.delete(ip);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 1, msg: 'success' }));
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 404, msg: 'record not found' }));
    }
    log('Unblocked IP:', ip);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () => {
  log(`listening on :${httpPort} (POST /api/v3/Objects/Blacklist, DELETE /api/v3/Objects/Blacklist/blist/{ip})`);
});
