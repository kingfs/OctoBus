#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../dptech__umc-ads_v5-3-29/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../dptech__umc-ads_v5-3-29/bin/dptech-umc-ads-v5-3-29.js", import.meta.url)),
});
