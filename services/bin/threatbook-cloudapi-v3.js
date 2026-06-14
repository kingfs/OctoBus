#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../threatbook__cloudapi_v3/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../threatbook__cloudapi_v3/bin/threatbook-cloudapi-v3.js", import.meta.url)),
});
