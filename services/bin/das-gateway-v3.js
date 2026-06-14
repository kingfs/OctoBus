#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../das__gateway_v3/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../das__gateway_v3/bin/das-gateway-v3.js", import.meta.url)),
});
