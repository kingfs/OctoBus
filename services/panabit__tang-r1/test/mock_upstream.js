/* node:coverage disable */
import http from 'node:http';

export const createMockServer = async ({ user = 'api_user', password = 'SuperSecret!' } = {}) => {
  let currentToken = `mock-token-${Date.now()}`;
  const requests = [];
  const ipTables = new Map([
    ['1024', { id: '1024', name: 'Block_IP_Firewall-01', member: ['203.0.113.10', '203.0.113.11'] }],
  ]);

  const writeJSON = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  const parseMultipart = async (req) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) return {};
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    const fields = {};
    for (const part of body.split(`--${boundaryMatch[1].trim()}`)) {
      const nameMatch = part.match(/name="([^"]+)"/);
      const valueMatch = part.match(/\r\n\r\n([\s\S]*?)\r\n/);
      if (nameMatch && valueMatch) fields[nameMatch[1]] = valueMatch[1];
    }
    return fields;
  };

  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

      if (req.method === 'GET' && url.pathname === '/api/panabit.cgi/API') {
        requests.push({ method: req.method, pathname: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers });
        if (url.searchParams.get('api_action') !== 'api_login') {
          writeJSON(res, 400, { code: -1, msg: 'invalid api_action' });
          return;
        }
        if (url.searchParams.get('username') !== user || url.searchParams.get('password') !== password) {
          writeJSON(res, 200, { code: 1, msg: 'authentication failed' });
          return;
        }
        currentToken = `token-${Date.now()}`;
        writeJSON(res, 200, { code: 0, data: currentToken });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/panabit.cgi') {
        const fields = await parseMultipart(req);
        requests.push({ method: req.method, pathname: url.pathname, fields, headers: req.headers });
        if (fields.api_route !== 'object@iptable') {
          writeJSON(res, 400, { code: -1, msg: 'invalid api_route' });
          return;
        }
        if (!fields.api_token || fields.api_token === 'invalid-token') {
          writeJSON(res, 401, { code: 401, msg: 'invalid or expired token' });
          return;
        }
        if (fields.api_action === 'list_iptable') {
          const keyword = fields.keyword || '';
          const data = Array.from(ipTables.values()).filter((item) => (keyword ? item.name.includes(keyword) : true));
          writeJSON(res, 200, { code: 0, msg: 'success', data });
          return;
        }
        if (fields.api_action === 'add_iptable') {
          const id = String(Date.now());
          ipTables.set(id, { id, name: fields.name, member: [] });
          writeJSON(res, 200, { code: 0, msg: 'add success' });
          return;
        }
        if (fields.api_action === 'add_tabip' || fields.api_action === 'rmv_tabip') {
          const table = ipTables.get(fields.id);
          if (!table) {
            writeJSON(res, 404, { code: -1, msg: 'iptable not found' });
            return;
          }
          if (fields.api_action === 'add_tabip' && !table.member.includes(fields.ip)) table.member.push(fields.ip);
          if (fields.api_action === 'rmv_tabip') {
            const idx = table.member.indexOf(fields.ip);
            if (idx !== -1) table.member.splice(idx, 1);
          }
          writeJSON(res, 200, { code: 0, msg: 'success' });
          return;
        }
        writeJSON(res, 400, { code: -1, msg: `unknown api_action: ${fields.api_action}` });
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    })().catch((err) => {
      writeJSON(res, 500, { code: -1, msg: err?.message || 'internal error' });
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
