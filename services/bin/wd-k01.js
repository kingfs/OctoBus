#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../wd__k01/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../wd__k01/bin/wd-k01.js", import.meta.url)),
});
