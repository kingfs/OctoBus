#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../riversafe__waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../riversafe__waf/bin/riversafe-waf.js", import.meta.url)),
});
