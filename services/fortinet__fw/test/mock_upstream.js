import http from 'node:http';

export const httpPort = Number(process.env.HTTP_PORT || 19093);
export const expectedToken = String(process.env.FORTINET_TOKEN || 'mock-fortinet-token').trim();

const log = (...args) => console.log('[mock-fortinet-fw]', ...args);
const addresses = new Map();
const addrGroups = new Map();

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const success = (body = {}) => ({
  status: 'success',
  http_status: 200,
  revision: 'mock-rev-1',
  ...body,
});

const failure = (httpStatus, error, extra = {}) => ({
  status: 'error',
  http_status: httpStatus,
  error,
  revision: 'mock-rev-1',
  ...extra,
});

const readJson = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw.trim()) {
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

const normalizeMembers = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({ name: String(item?.name || '').trim() }))
    .filter((item) => item.name);
};

const groupHasMember = (name) => Array.from(addrGroups.values()).some((group) => group.member.some((item) => item.name === name));

const requireAuth = (req, res) => {
  const auth = String(req.headers.authorization || '').trim();
  if (!auth) {
    json(res, 401, { message: 'missing bearer token' });
    return false;
  }
  if (auth !== `Bearer ${expectedToken}`) {
    json(res, 403, { message: 'permission denied' });
    return false;
  }
  return true;
};

const handleCreateAddress = async (req, res) => {
  const body = await readJson(req);
  const name = String(body?.name || '').trim();
  const subnet = String(body?.subnet || '').trim();
  if (!name || !subnet) {
    json(res, 200, failure(400, -1, { message: 'name and subnet required' }));
    return;
  }
  if (addresses.has(name)) {
    json(res, 200, failure(500, -5, { results: [{ name, subnet: addresses.get(name)?.subnet || subnet }] }));
    return;
  }
  const row = { name, subnet, type: 'ipmask' };
  addresses.set(name, row);
  json(res, 200, success({ results: [row] }));
};

const handleGetAddress = (res, ip) => {
  const row = addresses.get(ip);
  if (!row) {
    json(res, 404, failure(404, -3, { results: [] }));
    return;
  }
  json(res, 200, success({ results: [row] }));
};

const handleDeleteAddress = (res, ip) => {
  if (!addresses.has(ip)) {
    json(res, 404, failure(404, -3, { results: [] }));
    return;
  }
  if (groupHasMember(ip)) {
    json(res, 200, failure(500, -23, { results: [{ name: ip }] }));
    return;
  }
  addresses.delete(ip);
  json(res, 200, success({ results: [{ name: ip }] }));
};

const handleCreateAddrGroup = async (req, res) => {
  const body = await readJson(req);
  const name = String(body?.name || '').trim();
  const member = normalizeMembers(body?.member);
  if (!name) {
    json(res, 200, failure(400, -1, { message: 'name required' }));
    return;
  }
  if (addrGroups.has(name)) {
    json(res, 200, failure(500, -5, { results: [{ name }] }));
    return;
  }
  const row = { name, member };
  addrGroups.set(name, row);
  json(res, 200, success({ results: [row] }));
};

const handleGetAddrGroup = (res, name) => {
  const row = addrGroups.get(name);
  if (!row) {
    json(res, 404, failure(404, -3, { results: [] }));
    return;
  }
  json(res, 200, success({ results: [row] }));
};

const handleDeleteAddrGroup = (res, name) => {
  if (!addrGroups.has(name)) {
    json(res, 404, failure(404, -3, { results: [] }));
    return;
  }
  addrGroups.delete(name);
  json(res, 200, success({ results: [{ name }] }));
};

const handleAddAddrGroupMember = async (req, res, name) => {
  const row = addrGroups.get(name);
  if (!row) {
    json(res, 404, failure(404, -3, { results: [] }));
    return;
  }
  const body = await readJson(req);
  const memberName = String(body?.name || '').trim();
  if (!memberName) {
    json(res, 200, failure(400, -1, { message: 'name required' }));
    return;
  }
  if (row.member.some((item) => item.name === memberName)) {
    json(res, 200, failure(500, -5, { results: [{ name, member: row.member }] }));
    return;
  }
  row.member.push({ name: memberName });
  json(res, 200, success({ results: [{ name, member: row.member }] }));
};

const handleRemoveAddrGroupMember = (res, name, ip) => {
  const row = addrGroups.get(name);
  if (!row) {
    json(res, 404, failure(404, -3, { results: [] }));
    return;
  }
  const before = row.member.length;
  row.member = row.member.filter((item) => item.name !== ip);
  if (row.member.length === before) {
    json(res, 404, failure(404, -3, { results: [{ name, member: row.member }] }));
    return;
  }
  json(res, 200, success({ results: [{ name, member: row.member }] }));
};

const handlePutAddrGroup = async (req, res, name) => {
  const row = addrGroups.get(name);
  if (!row) {
    json(res, 404, failure(404, -3, { results: [] }));
    return;
  }
  const body = await readJson(req);
  row.member = normalizeMembers(body?.member);
  json(res, 200, success({ results: [{ name, member: row.member }] }));
};

export const createMockServer = () => http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    log(req.method, url.pathname + url.search);

    if (!requireAuth(req, res)) return;

    if (req.method === 'POST' && url.pathname === '/api/v2/cmdb/firewall/address') {
      await handleCreateAddress(req, res);
      return;
    }

    const addressMatch = url.pathname.match(/^\/api\/v2\/cmdb\/firewall\/address\/([^/]+)$/);
    if (addressMatch) {
      const ip = decodeURIComponent(addressMatch[1]);
      if (req.method === 'GET') {
        handleGetAddress(res, ip);
        return;
      }
      if (req.method === 'DELETE') {
        handleDeleteAddress(res, ip);
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/v2/cmdb/firewall/addrgrp') {
      await handleCreateAddrGroup(req, res);
      return;
    }

    const memberMatch = url.pathname.match(/^\/api\/v2\/cmdb\/firewall\/addrgrp\/([^/]+)\/member(?:\/([^/]+))?$/);
    if (memberMatch) {
      const groupName = decodeURIComponent(memberMatch[1]);
      const ip = memberMatch[2] ? decodeURIComponent(memberMatch[2]) : '';
      if (req.method === 'POST' && !ip) {
        await handleAddAddrGroupMember(req, res, groupName);
        return;
      }
      if (req.method === 'DELETE' && ip) {
        handleRemoveAddrGroupMember(res, groupName, ip);
        return;
      }
    }

    const groupMatch = url.pathname.match(/^\/api\/v2\/cmdb\/firewall\/addrgrp\/([^/]+)$/);
    if (groupMatch) {
      const groupName = decodeURIComponent(groupMatch[1]);
      if (req.method === 'GET') {
        handleGetAddrGroup(res, groupName);
        return;
      }
      if (req.method === 'DELETE') {
        handleDeleteAddrGroup(res, groupName);
        return;
      }
      if (req.method === 'PUT') {
        await handlePutAddrGroup(req, res, groupName);
        return;
      }
    }

    json(res, 404, { message: 'not found' });
  } catch (err) {
    json(res, 500, { message: String(err?.message || err) });
  }
});

if (process.argv[1] != null && import.meta.url === new URL(process.argv[1], 'file:').href) {
  createMockServer().listen(httpPort, () => {
    log(`HTTP mock listening on :${httpPort}`);
  });
}
