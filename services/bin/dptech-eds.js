#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../dptech__eds/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../dptech__eds/bin/dptech-eds.js", import.meta.url)),
});
