#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../nsfocus__nips_v5-6-r11/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../nsfocus__nips_v5-6-r11/bin/nsfocus-nips-v5-6-r11.js", import.meta.url)),
});
