#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../panabit__tang-r1/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../panabit__tang-r1/bin/panabit-tang-r1.js", import.meta.url)),
});
