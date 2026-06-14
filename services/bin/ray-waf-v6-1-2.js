#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ray__waf_v6-1-2/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ray__waf_v6-1-2/bin/ray-waf-v6-1-2.js", import.meta.url)),
});
