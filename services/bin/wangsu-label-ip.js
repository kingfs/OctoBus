#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../wangsu__label-ip/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../wangsu__label-ip/bin/wangsu-label-ip.js", import.meta.url)),
});
