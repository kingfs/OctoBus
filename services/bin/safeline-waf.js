#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__safeline-waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__safeline-waf/bin/safeline-waf.js", import.meta.url)),
});
