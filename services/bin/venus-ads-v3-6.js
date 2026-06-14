#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../venus__ads_v3-6/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../venus__ads_v3-6/bin/venus-ads-v3-6.js", import.meta.url)),
});
