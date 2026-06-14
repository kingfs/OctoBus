#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { defineService, runServiceMain } from "@chaitin-ai/octobus-sdk";

// Just for testing use, normally you don't need it for an actual service, feel free to remove it
function saveMetadata(metadata) {
  const workdir = process.cwd();
  const out = {};
  for (const key of Object.keys(metadata.getMap())) {
    out[key] = metadata.get(key).map(String);
  }
  fs.writeFileSync(path.join(workdir, "metadata.json"), JSON.stringify(out), { mode: 0o600 });
}

function businessRequestID(metadata) {
  return metadata.get("x-octobus-ext-business-request-id")[0] || metadata.get("x-business-request-id")[0] || "";
}

function calculatorHandler(operation) {
  return (ctx) => {
    saveMetadata(ctx.metadata);
    const request = ctx.request;
    const config = ctx.config ?? {};
    const secret = ctx.secret ?? {};

    return {
      result: operation(request.left, request.right),
      serviceId: process.env.OCTOBUS_SERVICE_ID || "",
      instanceId: process.env.OCTOBUS_INSTANCE_ID || "",
      label: config.label || "",
      businessRequestId: String(businessRequestID(ctx.metadata)),
      secretToken: secret.apiToken || "",
    };
  };
}

const service = defineService({
  handlers: {
    "calculator.v1.CalculatorService/Add": calculatorHandler((left, right) => left + right),
    "calculator.v1.CalculatorService/Subtract": calculatorHandler((left, right) => left - right),
  },
});

runServiceMain(service);
