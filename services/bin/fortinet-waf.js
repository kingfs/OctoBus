#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../fortinet__waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../fortinet__waf/bin/fortinet-waf.js", import.meta.url)),
});
