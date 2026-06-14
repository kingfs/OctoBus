#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__tsec_v2-5-1/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__tsec_v2-5-1/bin/tencent-tsec-v2-5-1.js", import.meta.url)),
});
