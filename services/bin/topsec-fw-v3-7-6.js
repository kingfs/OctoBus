#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../topsec__fw_v3-7-6/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../topsec__fw_v3-7-6/bin/topsec-fw-v3-7-6.js", import.meta.url)),
});
