#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../skycloud__inet/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../skycloud__inet/bin/skycloud-inet.js", import.meta.url)),
});
