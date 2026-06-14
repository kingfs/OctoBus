#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../das__tgfw_v6/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../das__tgfw_v6/bin/das-tgfw-v6.js", import.meta.url)),
});
