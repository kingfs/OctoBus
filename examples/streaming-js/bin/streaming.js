#!/usr/bin/env node

import { defineService, runServiceMain } from "@chaitin-ai/octobus-sdk";

function base(ctx) {
  const config = ctx.config ?? {};
  const secret = ctx.secret ?? {};
  return {
    serviceId: ctx.serviceId,
    instanceId: ctx.instanceId,
    label: config.label || "",
    businessRequestId: ctx.getMetadata("x-business-request-id") || "",
    secretToken: secret.apiToken || "",
  };
}

const service = defineService({
  handlers: {
    "streaming.v1.StreamingService/Echo": (ctx) => {
      const request = ctx.request;
      return { ...base(ctx), text: request.text, index: request.count };
    },
    "streaming.v1.StreamingService/Expand": async function* (ctx) {
      const request = ctx.request;
      const count = Math.max(0, request.count || 0);
      for (let i = 0; i < count; i += 1) {
        yield { ...base(ctx), text: request.text, index: i + 1 };
      }
    },
    "streaming.v1.StreamingService/Collect": async (ctx) => {
      const parts = [];
      let count = 0;
      for await (const request of ctx.requests) {
        count += 1;
        parts.push(request.text);
      }
      return { ...base(ctx), text: parts.join(","), index: count };
    },
    "streaming.v1.StreamingService/Chat": async function* (ctx) {
      let count = 0;
      for await (const request of ctx.requests) {
        count += 1;
        yield { ...base(ctx), text: request.text, index: count };
      }
    },
  },
});

runServiceMain(service);
