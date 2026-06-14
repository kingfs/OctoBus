#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../qingteng__hids_v3-4/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../qingteng__hids_v3-4/bin/qingteng-hids-v3-4.js", import.meta.url)),
});
