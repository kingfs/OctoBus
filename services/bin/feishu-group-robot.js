#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../feishu__group-robot/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../feishu__group-robot/bin/feishu-group-robot.js", import.meta.url)),
});
