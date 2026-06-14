import * as grpc from "@grpc/grpc-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as octobusSdk from "../src/index.js";
import { type GrpcReadableResult } from "../src/index.js";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const sdkDir = path.resolve(testsDir, "..");
const repoRoot = path.resolve(sdkDir, "..");
const sdkIndexUrl = pathToFileURL(path.join(sdkDir, "src", "index.ts")).href;

const exampleDirs = {
  calculator: path.join(repoRoot, "examples", "calculator-js"),
  onDemandCalculator: path.join(repoRoot, "examples", "calculator-on-demand-js"),
  streaming: path.join(repoRoot, "examples", "streaming-js"),
};

interface ImportedConnectClient {
  createConnectRpcClient(options: unknown): {
    CalculatorService?: { Add(request: unknown, options?: unknown): Promise<unknown> };
    StreamingService?: { Echo(request: unknown, options?: unknown): Promise<unknown> };
  };
}

interface ImportedGrpcClient {
  createGrpcClient(options: unknown): {
    close(): void;
    CalculatorService?: { Add(request: unknown, options?: unknown): Promise<unknown> };
    StreamingService?: {
      Echo(request: unknown, options?: unknown): Promise<unknown>;
      Expand(request: unknown, options?: unknown): GrpcReadableResult;
      Collect(requests: Iterable<unknown> | AsyncIterable<unknown>, options?: unknown): Promise<unknown>;
      Chat(requests: Iterable<unknown> | AsyncIterable<unknown>, options?: unknown): GrpcReadableResult;
    };
  };
}

interface ShimCalls {
  connect: unknown[];
  grpc: unknown[];
}

describe("generated client package consumption", () => {
  let server: grpc.Server | undefined;

  afterEach(() => {
    server?.forceShutdown();
    server = undefined;
  });

  it("imports generated Connect packages and calls descriptor-backed aliases without packageDir", async () => {
    await expectConnectAdd({
      packageDir: exampleDirs.calculator,
      request: { left: 7, right: 5 },
      response: { result: 12 },
      expectedBody: { left: 7, right: 5 },
      expectedMethod: "calculator.v1.CalculatorService/Add",
    });

    await expectConnectAdd({
      packageDir: exampleDirs.onDemandCalculator,
      request: { left: 9, right: 4 },
      response: { result: 13 },
      expectedBody: { left: 9, right: 4 },
      expectedMethod: "calculator.v1.CalculatorService/Add",
    });

    const { imported, calls, packageDir } = await generateAndImportConnect(exampleDirs.streaming, "@acme/streaming-connect-client");
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = imported.createConnectRpcClient({
      baseUrl: "http://127.0.0.1:8080/",
      capsetId: "dev capset",
      instanceId: "streaming-test",
      headers: { authorization: "Bearer token" },
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ text: "echo", index: 3 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(client.StreamingService?.Echo({ text: "echo", count: 3 }, {
      headers: { "x-request-id": "req-streaming" },
    })).resolves.toEqual({ text: "echo", index: 3 });

    expectFetchRequest(requests, {
      url: "http://127.0.0.1:8080/capsets/dev%20capset/connect/streaming-test/streaming.v1.StreamingService/Echo",
      body: { text: "echo", count: 3 },
      requestId: "req-streaming",
    });
    expectDescriptorBackedPackage(packageDir);
    expectOriginalPackageDirNotPassed(calls.connect, exampleDirs.streaming);
  });

  it("imports generated gRPC packages and calls high-level aliases without packageDir", async () => {
      await usingGrpcClient(server, (value) => {
        server = value;
      }, exampleDirs.calculator, "@acme/calculator-grpc-client", {
      handlers: calculatorHandlers,
      serviceId: "calculator",
      instanceId: "calculator-test",
    }, async (client, calls) => {
      await expect(client.CalculatorService?.Add({ left: 8, right: 6 }, {
        metadata: { "x-business-request-id": "biz-calculator" },
      })).resolves.toMatchObject({
        result: 14,
        serviceId: "calculator",
        instanceId: "calculator-test",
        label: "runtime",
        businessRequestId: "biz-calculator",
      });
      expectOriginalPackageDirNotPassed(calls.grpc, exampleDirs.calculator);
    });

    await usingGrpcClient(server, (value) => {
      server = value;
    }, exampleDirs.onDemandCalculator, "@acme/on-demand-calculator-grpc-client", {
      handlers: calculatorHandlers,
      serviceId: "calculator-on-demand",
      instanceId: "calculator-on-demand-test",
    }, async (client, calls) => {
      await expect(client.CalculatorService?.Add({ left: 10, right: 15 }, {
        metadata: { "x-business-request-id": "biz-on-demand" },
      })).resolves.toMatchObject({
        result: 25,
        serviceId: "calculator-on-demand",
        instanceId: "calculator-on-demand-test",
        label: "runtime",
        businessRequestId: "biz-on-demand",
      });
      expectOriginalPackageDirNotPassed(calls.grpc, exampleDirs.onDemandCalculator);
    });

    await usingGrpcClient(server, (value) => {
      server = value;
    }, exampleDirs.streaming, "@acme/streaming-grpc-client", {
      handlers: streamingHandlers,
      serviceId: "streaming",
      instanceId: "streaming-test",
    }, async (client, calls) => {
      const service = client.StreamingService;
      await expect(service?.Echo({ text: "hello", count: 7 }, {
        metadata: { "x-business-request-id": "biz-streaming" },
      })).resolves.toMatchObject({
        text: "hello",
        index: 7,
        serviceId: "streaming",
        instanceId: "streaming-test",
        label: "runtime",
        businessRequestId: "biz-streaming",
      });

      const expand = service?.Expand({ text: "expand", count: 3 });
      expect(expand).not.toBeInstanceOf(Promise);
      await expect(collectAsync(expectValue(expand))).resolves.toEqual([
        expect.objectContaining({ text: "expand", index: 1, serviceId: "streaming", instanceId: "streaming-test" }),
        expect.objectContaining({ text: "expand", index: 2, serviceId: "streaming", instanceId: "streaming-test" }),
        expect.objectContaining({ text: "expand", index: 3, serviceId: "streaming", instanceId: "streaming-test" }),
      ]);

      await expect(service?.Collect([
        { text: "a" },
        { text: "b" },
      ])).resolves.toMatchObject({ text: "a,b", index: 2 });

      await expect(service?.Collect(asyncRequests([
        { text: "c" },
        { text: "d" },
        { text: "e" },
      ]))).resolves.toMatchObject({ text: "c,d,e", index: 3 });

      const chat = service?.Chat(asyncRequests([
        { text: "first" },
        { text: "second" },
      ]));
      expect(chat).not.toBeInstanceOf(Promise);
      await expect(collectAsync(expectValue(chat))).resolves.toEqual([
        expect.objectContaining({ text: "first", index: 1, serviceId: "streaming", instanceId: "streaming-test" }),
        expect.objectContaining({ text: "second", index: 2, serviceId: "streaming", instanceId: "streaming-test" }),
      ]);
      expectOriginalPackageDirNotPassed(calls.grpc, exampleDirs.streaming);
    });
  });
});

async function expectConnectAdd(options: {
  packageDir: string;
  request: { left: number; right: number };
  response: unknown;
  expectedBody: unknown;
  expectedMethod: string;
}): Promise<void> {
  const { imported, calls, packageDir } = await generateAndImportConnect(
    options.packageDir,
    `@acme/${path.basename(options.packageDir)}-connect-client`,
  );
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = imported.createConnectRpcClient({
    baseUrl: "http://127.0.0.1:8080/",
    capsetId: "dev capset",
    instanceId: "calculator-test",
    headers: { authorization: "Bearer token" },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(options.response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await expect(client.CalculatorService?.Add(options.request, {
    headers: { "x-request-id": "req-add" },
  })).resolves.toEqual(options.response);

  expectFetchRequest(requests, {
    url: `http://127.0.0.1:8080/capsets/dev%20capset/connect/calculator-test/${options.expectedMethod.replace("/", "/")}`,
    body: options.expectedBody,
    requestId: "req-add",
  });
  expectDescriptorBackedPackage(packageDir);
  expectOriginalPackageDirNotPassed(calls.connect, options.packageDir);
}

async function generateAndImportConnect(packageDir: string, packageName: string): Promise<{
  imported: ImportedConnectClient;
  calls: ShimCalls;
  packageDir: string;
}> {
  const result = await generateAndImportClient(packageDir, packageName, "connect");
  return {
    imported: result.imported as ImportedConnectClient,
    calls: result.calls,
    packageDir: result.packageDir,
  };
}

async function generateAndImportGrpc(packageDir: string, packageName: string): Promise<{
  imported: ImportedGrpcClient;
  calls: ShimCalls;
  packageDir: string;
}> {
  const result = await generateAndImportClient(packageDir, packageName, "grpc");
  return {
    imported: result.imported as ImportedGrpcClient,
    calls: result.calls,
    packageDir: result.packageDir,
  };
}

async function generateAndImportClient(
  sourcePackageDir: string,
  packageName: string,
  transport: "connect" | "grpc",
): Promise<{ imported: unknown; calls: ShimCalls; packageDir: string }> {
  const consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), `octobus-${transport}-consumer-`));
  installSdkShim(consumerDir);
  installGrpcShim(consumerDir);

  const generatedPackageDir = path.join(consumerDir, "node_modules", ...packageName.split("/"));
  octobusSdk.writeClientPackage({
    transport,
    packageName,
    outDir: generatedPackageDir,
    cwd: sourcePackageDir,
    env: { OCTOBUS_PACKAGE_DIR: sourcePackageDir },
  });
  expectDescriptorBackedPackage(generatedPackageDir);

  const calls = resetShimCalls();
  const imported = await import(`${pathToFileURL(path.join(generatedPackageDir, "index.js")).href}?case=${Date.now()}-${Math.random()}`);
  return { imported, calls, packageDir: generatedPackageDir };
}

async function usingGrpcClient(
  currentServer: grpc.Server | undefined,
  setServer: (server: grpc.Server | undefined) => void,
  packageDir: string,
  packageName: string,
  service: {
    handlers: Parameters<typeof octobusSdk.defineService>[0]["handlers"];
    serviceId: string;
    instanceId: string;
  },
  run: (client: ReturnType<ImportedGrpcClient["createGrpcClient"]>, calls: ShimCalls) => Promise<void>,
): Promise<void> {
  const result = await octobusSdk.runService(octobusSdk.defineService({ handlers: service.handlers }), {
    argv: [
      "--runtime",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--config-json",
      "{\"label\":\"runtime\"}",
      "--service",
      service.serviceId,
      "--instance",
      service.instanceId,
    ],
    cwd: packageDir,
    env: { OCTOBUS_PACKAGE_DIR: packageDir },
  });
  if (result.command !== "serve") {
    throw new Error("expected serve result");
  }

  currentServer?.forceShutdown();
  setServer(result.server);
  const { imported, calls, packageDir: generatedPackageDir } = await generateAndImportGrpc(packageDir, packageName);
  expectDescriptorBackedPackage(generatedPackageDir);
  const client = imported.createGrpcClient({
    address: result.address,
    capsetId: "dev",
    serviceId: service.serviceId,
    instanceId: service.instanceId,
  });
  try {
    await run(client, calls);
  } finally {
    client.close();
    result.server.forceShutdown();
    setServer(undefined);
  }
}

const calculatorHandlers = {
  "calculator.v1.CalculatorService/Add": (ctx: { request: unknown; config?: unknown; serviceId: string; instanceId: string; getMetadata(name: string): string | undefined }) => {
    const request = ctx.request as { left: number; right: number };
    const config = ctx.config as { label?: string } | undefined;
    return {
      result: request.left + request.right,
      serviceId: ctx.serviceId,
      instanceId: ctx.instanceId,
      label: config?.label ?? "",
      businessRequestId: ctx.getMetadata("x-business-request-id") ?? "",
    };
  },
};

const streamingHandlers = {
  "streaming.v1.StreamingService/Echo": (ctx: { request: unknown; config?: unknown; serviceId: string; instanceId: string; getMetadata(name: string): string | undefined }) => {
    const request = ctx.request as { text: string; count: number };
    return {
      ...baseStreamingResponse(ctx),
      text: request.text,
      index: request.count,
    };
  },
  "streaming.v1.StreamingService/Expand": async function* (ctx: { request: unknown; config?: unknown; serviceId: string; instanceId: string; getMetadata(name: string): string | undefined }) {
    const request = ctx.request as { text: string; count: number };
    for (let i = 0; i < request.count; i += 1) {
      yield {
        ...baseStreamingResponse(ctx),
        text: request.text,
        index: i + 1,
      };
    }
  },
  "streaming.v1.StreamingService/Collect": async (ctx: { requests: AsyncIterable<unknown>; config?: unknown; serviceId: string; instanceId: string; getMetadata(name: string): string | undefined }) => {
    const parts: string[] = [];
    for await (const request of ctx.requests as AsyncIterable<{ text: string }>) {
      parts.push(request.text);
    }
    return {
      ...baseStreamingResponse(ctx),
      text: parts.join(","),
      index: parts.length,
    };
  },
  "streaming.v1.StreamingService/Chat": async function* (ctx: { requests: AsyncIterable<unknown>; config?: unknown; serviceId: string; instanceId: string; getMetadata(name: string): string | undefined }) {
    let index = 0;
    for await (const request of ctx.requests as AsyncIterable<{ text: string }>) {
      index += 1;
      yield {
        ...baseStreamingResponse(ctx),
        text: request.text,
        index,
      };
    }
  },
};

function baseStreamingResponse(ctx: { config?: unknown; serviceId: string; instanceId: string; getMetadata(name: string): string | undefined }): Record<string, unknown> {
  const config = ctx.config as { label?: string } | undefined;
  return {
    serviceId: ctx.serviceId,
    instanceId: ctx.instanceId,
    label: config?.label ?? "",
    businessRequestId: ctx.getMetadata("x-business-request-id") ?? "",
  };
}

function installSdkShim(consumerDir: string): void {
  const packageDir = path.join(consumerDir, "node_modules", "@chaitin-ai", "octobus-sdk");
  fs.mkdirSync(packageDir, { recursive: true });
  const globalWithSdk = globalThis as typeof globalThis & { __octobusSdkModule?: typeof octobusSdk };
  globalWithSdk.__octobusSdkModule = octobusSdk;
  fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
    name: "@chaitin-ai/octobus-sdk",
    version: "0.0.0-test",
    type: "module",
    main: "index.js",
  }), "utf8");
  fs.writeFileSync(path.join(packageDir, "index.js"), [
    `// SDK source target: ${sdkIndexUrl}`,
    `const sdk = globalThis.__octobusSdkModule;`,
    `globalThis.__octobusSdkShimCalls ??= { connect: [], grpc: [] };`,
    `export function createConnectRpcStub(options) {`,
    `  globalThis.__octobusSdkShimCalls.connect.push(options);`,
    `  return sdk.createConnectRpcStub(options);`,
    `}`,
    `export function createGrpcStub(options) {`,
    `  globalThis.__octobusSdkShimCalls.grpc.push(options);`,
    `  return sdk.createGrpcStub(options);`,
    `}`,
    `export const ConnectRpcError = sdk.ConnectRpcError;`,
    "",
  ].join("\n"), "utf8");
}

function installGrpcShim(consumerDir: string): void {
  const grpcPackageDir = path.join(consumerDir, "node_modules", "@grpc", "grpc-js");
  fs.mkdirSync(path.dirname(grpcPackageDir), { recursive: true });
  fs.symlinkSync(path.join(sdkDir, "node_modules", "@grpc", "grpc-js"), grpcPackageDir, "dir");
}

function resetShimCalls(): ShimCalls {
  const globalWithCalls = globalThis as typeof globalThis & { __octobusSdkShimCalls?: ShimCalls };
  globalWithCalls.__octobusSdkShimCalls = { connect: [], grpc: [] };
  return globalWithCalls.__octobusSdkShimCalls;
}

function expectFetchRequest(
  requests: Array<{ url: string; init: RequestInit }>,
  expected: { url: string; body: unknown; requestId: string },
): void {
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(expected.url);
  expect(requests[0].init.method).toBe("POST");
  expect(JSON.parse(String(requests[0].init.body))).toEqual(expected.body);
  const headers = new Headers(requests[0].init.headers);
  expect(headers.get("content-type")).toBe("application/json");
  expect(headers.get("accept")).toBe("application/json");
  expect(headers.get("authorization")).toBe("Bearer token");
  expect(headers.get("x-request-id")).toBe(expected.requestId);
}

function expectDescriptorBackedPackage(packageDir: string): void {
  expect(fs.existsSync(path.join(packageDir, "descriptors", "descriptor.pb"))).toBe(true);
  expect(fs.existsSync(path.join(packageDir, "descriptors", "service.json"))).toBe(true);
  const source = fs.readFileSync(path.join(packageDir, "index.js"), "utf8");
  expect(source).toContain(`const descriptorPath = join(__dirname, "descriptors", "descriptor.pb");`);
  expect(source).toContain(`const manifestPath = join(__dirname, "descriptors", "service.json");`);
}

function expectOriginalPackageDirNotPassed(calls: unknown[], originalPackageDir: string): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call).toEqual(expect.not.objectContaining({ packageDir: originalPackageDir }));
    expect(call).toEqual(expect.not.objectContaining({ cwd: originalPackageDir }));
    expect(call).toEqual(expect.objectContaining({
      descriptorPath: expect.stringContaining(path.join("descriptors", "descriptor.pb")),
      manifestPath: expect.stringContaining(path.join("descriptors", "service.json")),
    }));
  }
}

function expectValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("expected value");
  }
  return value;
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
