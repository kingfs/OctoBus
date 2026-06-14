#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../dptech__fw_v4-6-10/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../dptech__fw_v4-6-10/bin/dptech-fw-v4-6-10.js", import.meta.url)),
});
