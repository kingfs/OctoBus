#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../nsfocus__ads_v4-5-r90-f06/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../nsfocus__ads_v4-5-r90-f06/bin/nsfocus-ads-v4-5-r90-f06.js", import.meta.url)),
});
