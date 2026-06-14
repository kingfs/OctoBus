import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it } from "vitest";
import { createGrpcStub, defineService, generateClientStubSource, runService, status, type GrpcReadableResult } from "../src/index.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const repoRoot = path.resolve(fixturesDir, "../../..");
const streamingDir = path.join(repoRoot, "examples/streaming-js");

describe("gRPC stub", () => {
  let server: grpc.Server | undefined;

  afterEach(() => {
    server?.forceShutdown();
    server = undefined;
  });

  it("creates Promise unary methods with OctoBus routing metadata", async () => {
    let seenMetadata: Record<string, unknown> | undefined;
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          seenMetadata = {
            routeCapset: ctx.metadata.get("x-octobus-capset"),
            routeService: ctx.metadata.get("x-octobus-service"),
            routeInstance: ctx.metadata.get("x-octobus-instance"),
            requestId: ctx.metadata.get("x-request-id"),
            baseHeader: ctx.metadata.get("x-base"),
          };
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config-json", "{}"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const stub = createGrpcStub({
      packageDir: fixturesDir,
      address: result.address,
      capsetId: "dev",
      serviceId: "calculator",
      instanceId: "calculator-test",
      metadata: { "x-base": "base" },
    });
    try {
      await expect(stub.services["calculator.v1.CalculatorService"].Add({ left: 7, right: 5 }, {
        metadata: { "x-request-id": "req-1" },
      })).resolves.toMatchObject({ result: 12 });
    } finally {
      stub.close();
    }

    expect(seenMetadata).toEqual({
      routeCapset: [],
      routeService: [],
      routeInstance: [],
      requestId: ["req-1"],
      baseHeader: ["base"],
    });
  });

  it("supports full method invocation, raw clients, and gRPC error propagation", async () => {
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config-json", "{}"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const stub = createGrpcStub({ packageDir: fixturesDir, address: result.address });
    try {
      expect(stub.raw["calculator.v1.CalculatorService"]).toBeInstanceOf(grpc.Client);
      await expect(stub.invoke("/calculator.v1.CalculatorService/Add", { left: 2, right: 3 }))
        .resolves.toMatchObject({ result: 5 });
      await expect(stub.methods["calculator.v1.CalculatorService/Subtract"]({ left: 2, right: 3 }))
        .rejects.toMatchObject({
          code: status.UNIMPLEMENTED,
          details: "method calculator.v1.CalculatorService/Subtract is not implemented by package calculator@0.1.0",
        });
    } finally {
      stub.close();
    }
  });

  it("rejects missing services, missing methods, and non-iterable streaming requests", async () => {
    const stub = createGrpcStub({ packageDir: fixturesDir, address: "127.0.0.1:1" });
    try {
      expect(() => stub.service("calculator.v1.MissingService")).toThrow("gRPC service calculator.v1.MissingService is not defined");
      expect(() => stub.invoke("calculator.v1.CalculatorService/Missing", {})).toThrow("gRPC method calculator.v1.CalculatorService/Missing is not defined");
      expect(() => stub.methods["calculator.v1.CalculatorService/Chat"]({ text: "not iterable" })).toThrow("requires an iterable request");
      await expect(stub.methods["calculator.v1.CalculatorService/Sum"]({ text: "not iterable" }) as Promise<unknown>).rejects.toThrow("requires an iterable request");
    } finally {
      stub.close();
    }
  });

  it("accepts grpc.Metadata and skips undefined metadata values", async () => {
    let seenMetadata: Record<string, unknown> | undefined;
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          seenMetadata = {
            base: ctx.metadata.get("x-base"),
            invoke: ctx.metadata.get("x-invoke"),
            missing: ctx.metadata.get("x-missing"),
          };
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config-json", "{}"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const baseMetadata = new grpc.Metadata();
    baseMetadata.set("x-base", "base");
    const stub = createGrpcStub({
      packageDir: fixturesDir,
      address: result.address,
      metadata: baseMetadata,
    });
    try {
      await expect(stub.methods["calculator.v1.CalculatorService/Add"]({ left: 1, right: 2 }, {
        metadata: { "x-invoke": ["one", "two"], "x-missing": undefined },
      })).resolves.toMatchObject({ result: 3 });
    } finally {
      stub.close();
    }

    expect(seenMetadata).toEqual({
      base: ["base"],
      invoke: ["one, two"],
      missing: [],
    });
  });

  it("prints and imports an ESM wrapper for unary package methods", async () => {
    const source = generateClientStubSource({
      packageDir: fixturesDir,
      transport: "grpc",
      factoryName: "createCalculatorGrpcClient",
    });

    expect(source).toContain(`import { createGrpcStub } from "@chaitin-ai/octobus-sdk";`);
    expect(source).toContain("export function createCalculatorGrpcClient(options)");
    expect(source).toContain("raw: stub.raw");
    expect(source).toContain(`"CalculatorService": {`);
    expect(source).toContain(`"Add": (request, options) => stub.invoke("calculator.v1.CalculatorService/Add", request, options),`);
    expect(source).toContain(`"JsonShape": (request, options) => stub.invoke("calculator.v1.CalculatorService/JsonShape", request, options),`);
    expect(source).toContain(`"Sum": (requests, options) => stub.invoke("calculator.v1.CalculatorService/Sum", requests, options),`);
    expect(source).toContain(`"Watch": (request, options) => stub.invoke("calculator.v1.CalculatorService/Watch", request, options),`);
    expect(source).toContain(`"Chat": (requests, options) => stub.invoke("calculator.v1.CalculatorService/Chat", requests, options),`);

    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config-json", "{}"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const modulePath = writeGeneratedModule(source.replace(
      `from "@chaitin-ai/octobus-sdk"`,
      `from ${JSON.stringify(pathToFileURL(path.join(fixturesDir, "..", "..", "src", "index.ts")).href)}`,
    ));
    const imported = await import(pathToFileURL(modulePath).href) as {
      createCalculatorGrpcClient(options: Parameters<typeof createGrpcStub>[0]): {
        CalculatorService: { Add(request: unknown): Promise<unknown> };
        close(): void;
      };
    };
    const client = imported.createCalculatorGrpcClient({
      packageDir: fixturesDir,
      address: result.address,
    });
    try {
      await expect(client.CalculatorService.Add({ left: 4, right: 6 })).resolves.toMatchObject({ result: 10 });
    } finally {
      client.close();
    }
  });

  it("prints descriptor-backed wrappers for generated packages", () => {
    const source = generateClientStubSource({
      packageDir: fixturesDir,
      transport: "grpc",
      factoryName: "createCalculatorGrpcClient",
      descriptorBacked: true,
    });

    expect(source).toContain(`import { dirname, join } from "node:path";`);
    expect(source).toContain(`const descriptorPath = join(__dirname, "descriptors", "descriptor.pb");`);
    expect(source).toContain("createGrpcStub({");
    expect(source).toContain("descriptorPath,");
    expect(source).toContain("manifestPath,");
    expect(source).toContain(`"Sum": (requests, options) => stub.invoke("calculator.v1.CalculatorService/Sum", requests, options),`);
    expect(source).toContain(`"Watch": (request, options) => stub.invoke("calculator.v1.CalculatorService/Watch", request, options),`);
    expect(source).toContain(`"Chat": (requests, options) => stub.invoke("calculator.v1.CalculatorService/Chat", requests, options),`);
  });

  it("loads descriptor-backed stubs and supports all gRPC runtime method shapes", async () => {
    const descriptorDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-streaming-descriptor-"));
    const descriptorPath = path.join(descriptorDir, "descriptor.pb");
    const manifestPath = path.join(descriptorDir, "service.json");
    execFileSync("protoc", [
      "-I", path.join(streamingDir, "proto"),
      "--include_imports",
      `--descriptor_set_out=${descriptorPath}`,
      path.join(streamingDir, "proto", "streaming.proto"),
    ]);
    fs.copyFileSync(path.join(streamingDir, "service.json"), manifestPath);

    const result = await runService(defineService({
      handlers: {
        "streaming.v1.StreamingService/Echo": (ctx) => {
          const request = ctx.request as { text: string; count: number };
          return {
            text: request.text,
            index: request.count,
            serviceId: ctx.serviceId,
            instanceId: ctx.instanceId,
            label: (ctx.config as { label?: string }).label ?? "",
            businessRequestId: ctx.getMetadata("x-business-request-id") ?? "",
          };
        },
        "streaming.v1.StreamingService/Expand": async function* (ctx) {
          const request = ctx.request as { text: string; count: number };
          for (let i = 0; i < request.count; i += 1) {
            yield {
              text: request.text,
              index: i + 1,
              serviceId: ctx.serviceId,
              instanceId: ctx.instanceId,
              label: (ctx.config as { label?: string }).label ?? "",
            };
          }
        },
        "streaming.v1.StreamingService/Collect": async (ctx) => {
          const parts: string[] = [];
          for await (const request of ctx.requests as AsyncIterable<{ text: string }>) {
            parts.push(request.text);
          }
          return {
            text: parts.join(","),
            index: parts.length,
            serviceId: ctx.serviceId,
            instanceId: ctx.instanceId,
            businessRequestId: ctx.getMetadata("x-base") ?? "",
          };
        },
        "streaming.v1.StreamingService/Chat": async function* (ctx) {
          let index = 0;
          for await (const request of ctx.requests as AsyncIterable<{ text: string }>) {
            index += 1;
            yield {
              text: request.text,
              index,
              serviceId: ctx.serviceId,
              instanceId: ctx.instanceId,
              businessRequestId: ctx.getMetadata("x-base") ?? "",
            };
          }
        },
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config-json", "{\"label\":\"runtime\"}", "--service", "streaming", "--instance", "streaming-test"],
      cwd: streamingDir,
      env: { OCTOBUS_PACKAGE_DIR: streamingDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const stub = createGrpcStub({
      descriptorPath,
      manifestPath,
      address: result.address,
      capsetId: "dev",
      serviceId: "streaming",
      instanceId: "streaming-test",
      metadata: async () => ({ "x-base": "base" }),
    });
    try {
      const service = stub.services["streaming.v1.StreamingService"];
      expect(service.Echo.kind).toBe("unary");
      expect(service.Expand.kind).toBe("server_streaming");
      expect(service.Collect.kind).toBe("client_streaming");
      expect(service.Chat.kind).toBe("bidi_streaming");

      await expect(service.Echo({ text: "hello", count: 7 }, {
        metadata: { "x-business-request-id": "biz-1" },
      })).resolves.toMatchObject({
        text: "hello",
        index: 7,
        serviceId: "streaming",
        instanceId: "streaming-test",
        label: "runtime",
        businessRequestId: "biz-1",
      });

      const expand = service.Expand({ text: "expand", count: 3 }) as GrpcReadableResult;
      expect(expand).not.toBeInstanceOf(Promise);
      expect(expand.raw).toBeDefined();
      expect(expand.cancel).toEqual(expect.any(Function));
      await expect(collectAsync(expand)).resolves.toEqual([
        expect.objectContaining({ text: "expand", index: 1, serviceId: "streaming", instanceId: "streaming-test", label: "runtime" }),
        expect.objectContaining({ text: "expand", index: 2, serviceId: "streaming", instanceId: "streaming-test", label: "runtime" }),
        expect.objectContaining({ text: "expand", index: 3, serviceId: "streaming", instanceId: "streaming-test", label: "runtime" }),
      ]);

      await expect(service.Collect([
        { text: "a" },
        { text: "b" },
        { text: "c" },
      ])).resolves.toMatchObject({ text: "a,b,c", index: 3, serviceId: "streaming", instanceId: "streaming-test", businessRequestId: "base" });

      const chat = service.Chat(asyncRequests([
        { text: "first" },
        { text: "second" },
      ])) as GrpcReadableResult;
      expect(chat).not.toBeInstanceOf(Promise);
      await expect(collectAsync(chat)).resolves.toEqual([
        expect.objectContaining({ text: "first", index: 1, serviceId: "streaming", instanceId: "streaming-test", businessRequestId: "base" }),
        expect.objectContaining({ text: "second", index: 2, serviceId: "streaming", instanceId: "streaming-test", businessRequestId: "base" }),
      ]);
    } finally {
      stub.close();
    }
  });
});

function writeGeneratedModule(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-grpc-stub-"));
  const filePath = path.join(dir, "calculator-grpc-client.mjs");
  fs.writeFileSync(filePath, source, "utf8");
  return filePath;
}

async function collectAsync(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const items: unknown[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

async function* asyncRequests(items: unknown[]): AsyncIterable<unknown> {
  for (const item of items) {
    yield item;
  }
}
