#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../topsec__fw-2u/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../topsec__fw-2u/bin/topsec-fw-2u.js", import.meta.url)),
});
