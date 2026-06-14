// Safeline EliminateFalsePositive gRPC mock upstream
// Env: GRPC_PORT (default 50053), MOCK_RULE_ID, MOCK_RULE_TYPE

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const grpcPort = Number(process.env.GRPC_PORT || 50053);
const ruleId = Number(process.env.MOCK_RULE_ID || 20);
const ruleType = process.env.MOCK_RULE_TYPE || 'skynet_module';

const log = (...args) => console.log('[mock-safeline]', ...args);

const start = async () => {
  let grpc;
  let protoLoader;
  try {
    grpc = await import('@grpc/grpc-js');
    protoLoader = await import('@grpc/proto-loader');
  } catch (e) {
    log('gRPC mock skipped: install @grpc/grpc-js @grpc/proto-loader to enable');
    return;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const protoPath = path.join(__dirname, '..', 'proto', 'safeline_waf_eliminate_false_positive.proto');
  const pkgDef = protoLoader.loadSync(protoPath, {
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(pkgDef);
  const eliminate = proto?.safeline?.eliminate;
  if (!eliminate?.EliminateService?.service) {
    log('load proto failed: EliminateService not found');
    return;
  }

  const server = new grpc.Server();
  server.addService(eliminate.EliminateService.service, {
    EliminateFalsePositive: (call, cb) => {
      const req = call.request || {};
      log('received request', req);
      cb(null, {
        success: Boolean(req?.event_id),
        ruleId: ruleId,
        ruleType: ruleType,
      });
    },
  });

  server.bindAsync(`0.0.0.0:${grpcPort}`, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) {
      log('mock bind failed', err?.message || err);
      return;
    }
    server.start();
    log(`gRPC mock listening on :${grpcPort} (EliminateFalsePositive)`);
  });
};

start();
