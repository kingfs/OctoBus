#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../qiming-tianqing__waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../qiming-tianqing__waf/bin/qiming-tianqing-waf.js", import.meta.url)),
});
