import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18091);
const expectedUser = process.env.DPTECH_USER || 'dptech_user';
const expectedPassword = process.env.DPTECH_PASSWORD || 'dptech_password';

let packetFilterEnabled = 'false';
let addressGroups = [
  { name: 'Block_IP_0001', ip: '203.0.113.10/32,203.0.113.11/32', desc: 'blocked IPs' },
];
let securityPolicies = [
  { name: 'MSS_Block_IP', enabled: '1', action: '0', sourceIpObjects: 'Block_IP_0001' },
];

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const unauthorized = (res) => sendJson(res, 401, { ret: '-401', msg: 'unauthorized' });

const isAuthorized = (req) => {
  const auth = String(req.headers.authorization || '');
  const expected = `Basic ${Buffer.from(`${expectedUser}:${expectedPassword}`).toString('base64')}`;
  return auth === expected;
};

const parseJsonBody = (raw) => {
  if (!String(raw || '').trim()) return {};
  return JSON.parse(raw);
};

const ensureHeaders = (req) => {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const accept = String(req.headers.accept || '').toLowerCase();
  return contentType.includes('application/json') && accept.includes('application/json');
};

const server = http.createServer(async (req, res) => {
  if (!isAuthorized(req) || !ensureHeaders(req)) {
    unauthorized(res);
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/func/web_main/api/system/sysinfolist/pfInEfList') {
    sendJson(res, 200, { ret: '0', pfInEfList: { enable: packetFilterEnabled, ipVersion: '4' } });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/func/web_main/api/system/sysinfolist/pfInEfList') {
    const body = parseJsonBody(await readBody(req));
    packetFilterEnabled = String(body?.pfInEfList?.enable || 'false');
    sendJson(res, 200, { ret: '0' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/func/web_main/api/netaddr/netaddr_obj/netaddrobjlist') {
    const keyword = String(url.searchParams.get('searchValue') || '');
    const items = addressGroups.filter((item) => item.name.includes(keyword));
    sendJson(res, 200, { ret: '0', netaddrobjlist: items });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/func/web_main/api/netaddr/netaddr_obj/netaddrobjlist') {
    const body = parseJsonBody(await readBody(req));
    const item = body?.netaddrobjlist || {};
    addressGroups.push({ name: item.name, ip: item.ip, desc: item.desc || '' });
    sendJson(res, 200, { ret: '0' });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/func/web_main/api/netaddr/netaddr_obj/netaddrobjlist') {
    const body = parseJsonBody(await readBody(req));
    const item = body?.netaddrobjlist || {};
    if (String(item.name || '').includes('DUPLICATE')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Duplicate IP address ranges.');
      return;
    }
    addressGroups = addressGroups.map((group) =>
      group.name === item.oldName ? { name: item.name, ip: item.ip, desc: item.desc || '' } : group
    );
    sendJson(res, 200, { ret: '0' });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/func/web_main/api/netaddr/netaddr_obj/netaddrobjlist') {
    const body = parseJsonBody(await readBody(req));
    const item = body?.netaddrobjlist || {};
    addressGroups = addressGroups.filter((group) => group.name !== item.name);
    sendJson(res, 200, { ret: '0' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/func/web_main/api/pf_policy/pf_policy/pf_policy/securitypolicylist') {
    const name = String(url.searchParams.get('name') || '');
    const item = securityPolicies.filter((policy) => policy.name === name);
    sendJson(res, 200, { ret: '0', securitypolicylist: item });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/func/web_main/api/pf_policy/pf_policy/pf_policy/securitypolicylist') {
    const body = parseJsonBody(await readBody(req));
    const item = body?.securitypolicylist || {};
    securityPolicies.push({
      name: item.name,
      enabled: item.enabled,
      action: item.action,
      sourceIpObjects: item.sourceIpGroups || '',
    });
    sendJson(res, 200, { ret: '0' });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/func/web_main/api/pf_policy/pf_policy/pf_policy/securitypolicylist') {
    const body = parseJsonBody(await readBody(req));
    const item = body?.securitypolicylist || {};
    securityPolicies = securityPolicies.map((policy) =>
      policy.name === item.oldName
        ? { name: item.name, enabled: item.enabled, action: item.action, sourceIpObjects: item.sourceIpObjects || '' }
        : policy
    );
    sendJson(res, 200, { ret: '0' });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/func/web_main/api/pf_policy/pf_policy/pf_policy/securitypolicylist') {
    const body = parseJsonBody(await readBody(req));
    const item = body?.securitypolicylist || {};
    securityPolicies = securityPolicies.filter((policy) => policy.name !== item.name);
    sendJson(res, 200, { ret: '0' });
    return;
  }

  sendJson(res, 404, { ret: '-404', msg: 'not found' });
});

server.listen(httpPort, () => {
  console.log(`[mock-dptech-fw-v4610] listening on :${httpPort}`);
});
