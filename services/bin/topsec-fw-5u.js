#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../topsec__fw-5u/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../topsec__fw-5u/bin/topsec-fw-5u.js", import.meta.url)),
});
