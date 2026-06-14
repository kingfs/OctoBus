// Mock upstream for Safeline DetectLogAggregateView
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18080);
const log = (...args) => console.log('[mock-safeline]', ...args);

const sample = [
  {
    event_id: 'evt-1',
    country: 'CN',
    province: 'ZJ',
    src_ip: '1.1.1.1',
    dst_port: '443',
    attack_type: 'sqli',
    method: 'GET',
    website: 'example.com',
    website_name: 'Example',
    module: 'waf',
    timestamp: '2024-01-01T00:00:00Z',
    scheme: 'https',
    dst_ip: '2.2.2.2',
    url_path: '/login',
    risk_level: 'high',
    status_code: '403',
    risk_level_num: '3',
    action: 'block',
    reason: 'sql injection',
    payload: "' or 1=1",
    socket_ip: '10.0.0.1',
    threat_confidence: '80',
    threat_risk_level: '3',
    threat_last_timestamp: '2024-01-01T00:00:00Z',
    matched_threat_tag: 'sqli',
    flag: 'malicious',
    count: '12'
  }
];

const ipGroups = new Map();
ipGroups.set(123, {
  id: 123,
  name: 'default-group',
  comment: 'default comment',
  original: ['1.1.1.1'],
  cidrs: ['1.1.1.0/24']
});

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/api/DetectLogAggregateView')) {
    // 模拟聚合接口，忽略 condition 参数
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(sample));
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/api/IPGroupAPI')) {
    const url = new URL(req.url, 'http://localhost');
    const params = url.searchParams;
    const nameFilters = params.getAll('name');
    const commentFilters = params.getAll('comment');
    const cidr = params.get('cidr');
    const count = Number(params.get('count'));
    const offset = Number(params.get('offset'));

    const token = req.headers['api-token'] || '';
    if (!token) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ err: { code: 401 }, msg: 'missing token', data: { list: [] } }));
      return;
    }

    let list = Array.from(ipGroups.values());
    if (nameFilters.length) {
      list = list.filter((item) => nameFilters.includes(item.name));
    }
    if (commentFilters.length) {
      list = list.filter((item) => commentFilters.includes(item.comment));
    }
    if (cidr) {
      list = list.filter((item) => item.cidrs.some((c) => c === cidr));
    }

    const total = list.length;
    const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
    const size = Number.isFinite(count) && count > 0 ? count : list.length;
    list = list.slice(start, start + size);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        err: null,
        msg: 'ok',
        data: {
          total,
          count: size,
          offset: start,
          list: list.map((item) => ({ ...item, id: String(item.id) })),
        },
      })
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/api/IPGroupAPI') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString();
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const token = req.headers['api-token'] || '';

      if (!token) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'missing token' }));
        return;
      }

      if (!body.name) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'name required' }));
        return;
      }

      const payload = {
        id: 'gid-123',
        name: body.name,
        comment: body.comment || '',
        original: Array.isArray(body.original) ? body.original : [],
        cidrs: ['1.1.1.0/24', '2.2.2.0/24']
      };
      ipGroups.set(123, {
        id: 123,
        name: payload.name,
        comment: payload.comment,
        original: payload.original,
        cidrs: payload.cidrs
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
      log('created IP group', payload);
    });
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/IPGroupAPI') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString();
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const token = req.headers['api-token'] || '';

      if (!token) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'missing token' }));
        return;
      }

      const id = Number(body.id);
      if (!Number.isInteger(id)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'id required' }));
        return;
      }

      const existing = ipGroups.get(id);
      if (!existing) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
        return;
      }

      const next = {
        ...existing,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
        ...(body.original !== undefined && Array.isArray(body.original) ? { original: body.original } : {})
      };
      ipGroups.set(id, next);

      const payload = {
        id: String(id),
        name: next.name,
        comment: next.comment,
        original: next.original,
        cidrs: next.cidrs
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
      log('updated IP group', payload);
    });
    return;
  }

  if (req.method === 'DELETE' && req.url === '/api/IPGroupAPI') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString();
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const token = req.headers['api-token'] || '';

      if (!token) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'missing token' }));
        return;
      }

      const ids = Array.isArray(body['id__in']) ? body['id__in'].map((v) => Number(v)) : [];
      const deleteAll = Boolean(body.delete_all_resources);

      if (!ids.length && !deleteAll) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'id__in required unless delete_all_resources' }));
        return;
      }

      if (ids.length && deleteAll) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'conflict params' }));
        return;
      }

      if (deleteAll) {
        ipGroups.clear();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ err: null, msg: 'deleted all', data: { deleted_all: true } }));
        log('deleted all groups');
        return;
      }

      const deleted = [];
      ids.forEach((id) => {
        if (ipGroups.delete(id)) {
          deleted.push(id);
        }
      });

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ err: null, msg: 'ok', data: { deleted } }));
      log('deleted ids', deleted);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/EditIPGroupItem') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString();
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const token = req.headers['api-token'] || '';

      if (!token) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'missing token' }));
        return;
      }

      const id = Number(body.id);
      if (!Number.isInteger(id)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'id required' }));
        return;
      }

      const group = ipGroups.get(id);
      if (!group) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'group not found' }));
        return;
      }

      if (body.targets !== undefined && !Array.isArray(body.targets)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'targets must be array' }));
        return;
      }

      const targets = Array.isArray(body.targets) ? body.targets.map(String) : [];
      const original = Array.from(new Set([...(group.original || []), ...targets]));
      const cidrs = original.map((ip) => `${ip}/32`);

      const next = { ...group, original, cidrs };
      ipGroups.set(id, next);

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ err: null, msg: 'ok', data: { ...next, id: String(id) } }));
      log('add items', { id, targets });
    });
    return;
  }

  if (req.method === 'DELETE' && req.url === '/api/EditIPGroupItem') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString();
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const token = req.headers['api-token'] || '';

      if (!token) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'missing token' }));
        return;
      }

      const id = Number(body.id);
      if (!Number.isInteger(id)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'id required' }));
        return;
      }

      const group = ipGroups.get(id);
      if (!group) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'group not found' }));
        return;
      }

      if (body.targets !== undefined && !Array.isArray(body.targets)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'targets must be array' }));
        return;
      }

      const targets = Array.isArray(body.targets) ? new Set(body.targets.map(String)) : null;
      const original = targets
        ? group.original.filter((ip) => !targets.has(ip))
        : group.original || [];
      const cidrs = original.map((ip) => `${ip}/32`);

      const next = { ...group, original, cidrs };
      ipGroups.set(id, next);

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ err: null, msg: null, data: null }));
      log('delete items', { id, targets: targets ? Array.from(targets) : undefined });
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () =>
  log(
    `listening on :${httpPort} (GET /api/DetectLogAggregateView?..., POST/PUT/DELETE /api/IPGroupAPI)`
  )
);
