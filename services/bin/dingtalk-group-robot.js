#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../dingtalk__group-robot/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../dingtalk__group-robot/bin/dingtalk-group-robot.js", import.meta.url)),
});
