#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__safeline-waf-eliminate-false-positive/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__safeline-waf-eliminate-false-positive/bin/safeline-waf-eliminate-false-positive.js", import.meta.url)),
});
