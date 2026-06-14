#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../hillstone__fw_v5-5-r4/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../hillstone__fw_v5-5-r4/bin/hillstone-fw-v5-5-r4.js", import.meta.url)),
});
