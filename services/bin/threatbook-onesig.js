#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../threatbook__onesig/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../threatbook__onesig/bin/threatbook-onesig.js", import.meta.url)),
});
