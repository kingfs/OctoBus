/* node:coverage disable */
import http from 'node:http';

export const createMockServer = async () => {
  let nextId = 6;
  const blacklist = [
    [1, '192.168.20.0', '255.255.255.255', 0, 0, '', 0],
    [4, '192.168.20.22', '255.255.255.255', 0, 0, '', 0],
  ];
  const requests = [];

  const readJson = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) {
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

  const sendJson = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', 'http://localhost');
      requests.push({ method: req.method, url: req.url, headers: req.headers });

      if (req.method === 'GET' && url.pathname === '/apicenter/login/') {
        const username = url.searchParams.get('username') || '';
        const password = url.searchParams.get('password') || '';
        if (!username || !password) {
          sendJson(res, 400, { success: 'false', errormessage: 'missing credential' });
          return;
        }
        if (username === 'denied') {
          sendJson(res, 403, { success: 'false', errormessage: 'permission denied' });
          return;
        }
        if (password === 'bad-password') {
          sendJson(res, 200, { success: 'false', errormessage: 'bad credential' });
          return;
        }
        sendJson(res, 200, {
          adminid: '1',
          pwd_comp: '1',
          pwd_lasttime: '0',
          pwd_len: '10',
          pwd_update_cycle: '30',
          random: 'x3ilv79je222bg4zaca57by45gwha212',
          redirecturl: 'index',
          reminder: '0',
          success: 'true',
          userauth: '1',
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/apicenter/' && url.searchParams.get('action') === 'blacklist_query') {
        const random = url.searchParams.get('random') || '';
        if (!random) {
          sendJson(res, 401, { errormessage: 'missing random' });
          return;
        }
        if (random === 'bad-json') {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('not-json');
          return;
        }
        sendJson(res, 200, {
          aaData: blacklist,
          iTotalDisplayRecords: blacklist.length,
          iTotalRecords: blacklist.length,
          sEcho: '1',
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/apicenter/' && url.searchParams.get('action') === 'blacklist_update') {
        const random = url.searchParams.get('random') || '';
        if (!random) {
          sendJson(res, 401, { errormessage: 'missing random' });
          return;
        }
        if (random === 'server-error') {
          sendJson(res, 503, { errormessage: 'temporary unavailable' });
          return;
        }
        const body = await readJson(req);
        if (!body.ip) {
          sendJson(res, 400, { success: 'false', errormessage: 'ip required' });
          return;
        }
        if (body.ip === '203.0.113.250') {
          sendJson(res, 200, { success: 'false', errormessage: 'duplicate ip' });
          return;
        }
        const id = nextId;
        nextId += 1;
        blacklist.push([id, body.ip, body.mask || '255.255.255.0', 0, 0, body.remark || '', 0]);
        sendJson(res, 200, { errormessage: 'add success', id, success: 'true' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/apicenter/' && url.searchParams.get('action') === 'blacklist_del') {
        const random = url.searchParams.get('random') || '';
        if (!random) {
          sendJson(res, 401, { errormessage: 'missing random' });
          return;
        }
        const body = await readJson(req);
        if (!body.ids) {
          sendJson(res, 400, { success: 'false', errormessage: 'ids required' });
          return;
        }
        const targets = String(body.ids).split(',').map((item) => item.trim()).filter(Boolean);
        if (targets.length === 0) {
          sendJson(res, 400, { success: 'false', errormessage: 'ids required' });
          return;
        }
        for (let i = blacklist.length - 1; i >= 0; i -= 1) {
          const id = String(blacklist[i]?.[0] ?? '').trim();
          if (targets.includes(id)) blacklist.splice(i, 1);
        }
        sendJson(res, 200, { errormessage: 'delete success', success: 'true' });
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    })().catch((err) => {
      sendJson(res, 400, { success: 'false', errormessage: String(err?.message || err) });
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
