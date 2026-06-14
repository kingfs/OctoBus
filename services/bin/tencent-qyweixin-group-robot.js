#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__qyweixin-group-robot/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__qyweixin-group-robot/bin/tencent-qyweixin-group-robot.js", import.meta.url)),
});
