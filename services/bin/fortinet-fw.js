#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../fortinet__fw/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../fortinet__fw/bin/fortinet-fw.js", import.meta.url)),
});
