#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../threatbook__tip_v4/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../threatbook__tip_v4/bin/threatbook-tip-v4.js", import.meta.url)),
});
