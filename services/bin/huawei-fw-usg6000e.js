#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../huawei__fw-usg6000e/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../huawei__fw-usg6000e/bin/huawei-fw-usg6000e.js", import.meta.url)),
});
