import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it } from "vitest";
import { defineService, GrpcError, status, runSdkCli, runService } from "../src/index.js";
import { healthServiceDefinition } from "../src/health.js";
import { loadServicePackage } from "../src/proto-loader.js";
import calculatorService from "./fixtures/calculator-handler.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("integration", () => {
  let server: grpc.Server | undefined;

  afterEach(() => {
    server?.forceShutdown();
    server = undefined;
  });

  it("starts a server, dispatches handlers, maps errors, and serves health", async () => {
    const configPath = writeConfig({ label: "test" });
    const result = await runService(calculatorService, {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config", configPath],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const calculator = createClient(result.address, path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });

    await expect(unary<{ result: number }>(calculator, "Add", { left: 7, right: 5 })).resolves.toMatchObject({ result: 12 });

    await expect(unary(calculator, "Subtract", { left: 7, right: 5 })).rejects.toMatchObject({
      code: status.UNIMPLEMENTED,
      details: "method calculator.v1.CalculatorService/Subtract is not implemented by package calculator@0.1.0",
    });

    await expect(unary(calculator, "Add", { left: -1, right: 5 })).rejects.toMatchObject({
      code: status.INVALID_ARGUMENT,
      details: "left must not be -1",
    });

    await expect(unary(calculator, "Add", { left: -2, right: 5 })).rejects.toMatchObject({
      code: status.INTERNAL,
      details: "ordinary failure",
    });

    const health = createClient(result.address, path.join(fixturesDir, "health.proto"), (grpcObject) => {
      return grpcObject.grpc.health.v1.Health;
    });
    await expect(unary<{ status: number }>(health, "Check", { service: "" })).resolves.toEqual({ status: 1 });
  });

  it("dispatches leading-slash handler keys with normalized context method", async () => {
    const configPath = writeConfig({});
    let seenMethod = "";
    const result = await runService(defineService({
      handlers: {
        "/calculator.v1.CalculatorService/Add": (ctx) => {
          seenMethod = ctx.method;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config", configPath],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const calculator = createClient(result.address, path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });

    await expect(unary<{ result: number }>(calculator, "Add", { left: 3, right: 4 })).resolves.toMatchObject({ result: 7 });
    expect(seenMethod).toBe("calculator.v1.CalculatorService/Add");
  });

  it("starts a dev server with inline config", async () => {
    const stdout = writableBuffer();
    let seenConfig: unknown;
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          seenConfig = ctx.config;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "dev", "--host", "127.0.0.1", "--port", "0", "--config-json", `{"label":"dev"}`],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    expect(stdout.data()).toBe(`${result.address}\n`);
    const calculator = createClient(result.address, path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });
    await expect(unary<{ result: number }>(calculator, "Add", { left: 2, right: 3 })).resolves.toMatchObject({ result: 5 });
    expect(seenConfig).toEqual({ label: "dev" });
  });

  it("starts a dev server with OCTOBUS_SERVICE_CONTEXT overriding matching CLI fields", async () => {
    const stdout = writableBuffer();
    let seenContext: unknown;
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          seenContext = { config: ctx.config, secret: ctx.secret };
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "dev", "--host", "127.0.0.1", "--port", "0", "--config-json", `{"label":"cli"}`, "--secret-json", `{"apiToken":"cli-secret"}`],
      cwd: fixturesDir,
      env: {
        OCTOBUS_PACKAGE_DIR: fixturesDir,
        OCTOBUS_SERVICE_CONTEXT: `{"config":{"label":"env"},"secret":{"apiToken":"env-secret"}}`,
      },
      stdout,
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const calculator = createClient(result.address, path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });
    await expect(unary<{ result: number }>(calculator, "Add", { left: 2, right: 3 })).resolves.toMatchObject({ result: 5 });
    expect(seenContext).toEqual({
      config: { label: "env" },
      secret: { apiToken: "env-secret" },
    });
  });

  it("registers streaming methods and passes context", async () => {
    const configPath = writeConfig({});
    const secretPath = writeJSONFile("secret", { apiToken: "stream-secret" });
    const metadata = new grpc.Metadata();
    metadata.add("x-business-request-id", "stream-req");
    let seenContext: unknown;
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => ({ result: 1 }),
        "calculator.v1.CalculatorService/Sum": async (ctx) => {
          let result = 0;
          for await (const request of ctx.requests as AsyncIterable<{ left: number; right: number }>) {
            result += request.left + request.right;
          }
          return { result };
        },
        "calculator.v1.CalculatorService/Watch": async function* (ctx) {
          seenContext = {
            config: ctx.config,
            secret: ctx.secret,
            serviceId: ctx.serviceId,
            instanceId: ctx.instanceId,
            requestId: ctx.getMetadata("x-business-request-id"),
          };
          const request = ctx.request as { left: number; right: number };
          yield { result: request.left };
          yield { result: request.right };
        },
        "calculator.v1.CalculatorService/Chat": async function* (ctx) {
          for await (const request of ctx.requests as AsyncIterable<{ left: number; right: number }>) {
            yield { result: request.left + request.right };
          }
        },
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config", configPath, "--secret", secretPath, "--service", "svc", "--instance", "inst"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const calculator = createClient(result.address, path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });

    await expect(unary<{ result: number }>(calculator, "Add", { left: 1, right: 1 })).resolves.toMatchObject({ result: 1 });
    await expect(clientStreaming(calculator, "Sum", [{ left: 1, right: 2 }, { left: 3, right: 4 }])).resolves.toMatchObject({ result: 10 });
    await expect(serverStreaming(calculator, "Watch", { left: 1, right: 2 }, metadata)).resolves.toMatchObject([{ result: 1 }, { result: 2 }]);
    expect(seenContext).toEqual({
      config: {},
      secret: { apiToken: "stream-secret" },
      serviceId: "svc",
      instanceId: "inst",
      requestId: "stream-req",
    });
    await expect(bidiStreaming(calculator, "Chat", [{ left: 1, right: 2 }, { left: 4, right: 5 }])).resolves.toMatchObject([{ result: 3 }, { result: 9 }]);
  });

  it("keeps package discovery separate from workdir and resolves relative config from workdir", async () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-workdir-"));
    fs.writeFileSync(path.join(workdir, "config.json"), JSON.stringify({ label: "from-workdir" }), "utf8");
    fs.writeFileSync(path.join(workdir, "secret.json"), JSON.stringify({ apiToken: "from-workdir-secret" }), "utf8");
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          const request = ctx.request as { left: number; right: number };
          expect(ctx.config).toEqual({ label: "from-workdir" });
          expect(ctx.secret).toEqual({ apiToken: "from-workdir-secret" });
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config", "config.json", "--secret", "secret.json", "--workdir", workdir],
      cwd: fixturesDir,
      env: {},
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const calculator = createClient(result.address, path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });

    await expect(unary<{ result: number }>(calculator, "Add", { left: 6, right: 7 })).resolves.toMatchObject({ result: 13 });
  });

  it("does not re-resolve absolute config under workdir", async () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-abs-workdir-"));
    const configPath = writeConfig({ label: "absolute" });
    const secretPath = writeJSONFile("secret", { apiToken: "absolute-secret" });
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          const request = ctx.request as { left: number; right: number };
          expect(ctx.config).toEqual({ label: "absolute" });
          expect(ctx.secret).toEqual({ apiToken: "absolute-secret" });
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config", configPath, "--secret", secretPath, "--workdir", workdir],
      cwd: fixturesDir,
      env: {},
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const calculator = createClient(result.address, path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });

    await expect(unary<{ result: number }>(calculator, "Add", { left: 2, right: 9 })).resolves.toMatchObject({ result: 11 });
  });

  it("uses OCTOBUS_PACKAGE_DIR before cwd package discovery", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-package-override-"));
    const workdir = path.join(root, "workdir");
    const cwdPackage = path.join(root, "cwd-package");
    fs.mkdirSync(path.join(cwdPackage, "proto"), { recursive: true });
    fs.mkdirSync(workdir);
    fs.writeFileSync(path.join(workdir, "config.json"), JSON.stringify({ label: "override" }), "utf8");
    fs.writeFileSync(path.join(cwdPackage, "service.json"), JSON.stringify({
      schema: "chaitin.octobus.service.v1",
      name: "wrong",
      entry: "wrong",
      proto: {
        roots: ["proto"],
        files: ["missing.proto"],
      },
    }), "utf8");

    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => ({ result: 42 }),
      },
    }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config", "config.json", "--workdir", workdir],
      cwd: cwdPackage,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const calculator = createClient(result.address, path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });

    await expect(unary<{ result: number }>(calculator, "Add", { left: 0, right: 0 })).resolves.toMatchObject({ result: 42 });
  });

  it("formats unimplemented errors without package version when absent", async () => {
    const packageDir = copyFixturePackageWithoutVersion();
    const configPath = writeConfig({});
    const result = await runService(defineService({ handlers: {} }), {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config", configPath],
      cwd: packageDir,
      env: { OCTOBUS_PACKAGE_DIR: packageDir },
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const calculator = createClient(result.address, path.join(packageDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });

    await expect(unary(calculator, "Add", { left: 1, right: 1 })).rejects.toMatchObject({
      code: status.UNIMPLEMENTED,
      details: "method calculator.v1.CalculatorService/Add is not implemented by package calculator",
    });
  });

  it("invoke decodes stdin protobuf, dispatches unary handler, and writes protobuf response only to stdout", async () => {
    const configPath = writeConfig({ label: "invoke" });
    const secretPath = writeJSONFile("secret", { apiToken: "invoke-secret" });
    const metadataPath = writeJSONFile("metadata", { "x-business-request-id": ["req-1"], "x-octobus-capset": ["dev"] });
    const request = serializeMessage(path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService.service.Add.requestSerialize({ left: 4, right: 9 });
    });
    const stdin = readableBuffer(request);
    const stdout = writableBuffer();
    const stderr = writableBuffer();

    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          expect(ctx.config).toEqual({ label: "invoke" });
          expect(ctx.secret).toEqual({ apiToken: "invoke-secret" });
          expect(ctx.metadata.get("x-business-request-id")).toEqual(["req-1"]);
          expect(ctx.metadata.get("x-octobus-capset")).toEqual([]);
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "invoke", "--method", "calculator.v1.CalculatorService/Add", "--config", configPath, "--secret", secretPath, "--metadata", metadataPath, "--workdir", path.dirname(configPath)],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdin,
      stdout,
      stderr,
    });

    expect(result.command).toBe("invoke");
    expect(stderr.data()).toBe("");
    const decoded = deserializeCalculatorResponse(stdout.buffer());
    expect(decoded).toMatchObject({ result: 13 });
  });

  it("service cli dispatches handler and writes JSON response", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-cli-cwd-"));
    const configPath = path.join(cwd, "config.json");
    const secretPath = path.join(cwd, "secret.json");
    const metadataPath = path.join(cwd, "metadata.json");
    fs.writeFileSync(configPath, JSON.stringify({ label: "cli" }), "utf8");
    fs.writeFileSync(secretPath, JSON.stringify({ apiToken: "cli-secret" }), "utf8");
    fs.writeFileSync(metadataPath, JSON.stringify({ "x-business-request-id": ["cli-req"], "x-octobus-instance": "hidden" }), "utf8");
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          expect(ctx.config).toEqual({ label: "cli" });
          expect(ctx.secret).toEqual({ apiToken: "cli-secret" });
          expect(ctx.metadata.get("x-business-request-id")).toEqual(["cli-req"]);
          expect(ctx.metadata.get("x-octobus-instance")).toEqual([]);
          expect(ctx.serviceId).toBe("");
          expect(ctx.instanceId).toBe("");
          expect(ctx.workdir).toBe(cwd);
          expect(ctx.packageDir).toBe(fixturesDir);
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["add", "--data-json", `{"left":8,"right":5}`, "--config", "config.json", "--secret", "secret.json", "--metadata", "metadata.json"],
      cwd,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
      stderr,
    });

    expect(result.command).toBe("cli");
    expect(result.method).toBe("calculator.v1.CalculatorService/Add");
    expect(stderr.data()).toBe("");
    expect(JSON.parse(stdout.data())).toEqual({ result: 13 });
  });

  it("service cli reads config and secret from OCTOBUS_SERVICE_CONTEXT", async () => {
    const seen: Record<string, unknown> = {};
    const stdout = writableBuffer();
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          seen.config = ctx.config;
          seen.secret = ctx.secret;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["add", "--data-json", `{"left":1,"right":2}`],
      cwd: fixturesDir,
      env: {
        OCTOBUS_PACKAGE_DIR: fixturesDir,
        OCTOBUS_SERVICE_CONTEXT: `{"config":{"label":"env"},"secret":{"apiToken":"env-secret"}}`,
      },
      stdout,
    });

    expect(result).toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/Add" });
    expect(JSON.parse(stdout.data())).toEqual({ result: 3 });
    expect(seen).toEqual({
      config: { label: "env" },
      secret: { apiToken: "env-secret" },
    });
  });

  it("service cli reads OCTOBUS_SERVICE_CONTEXT from .env in the current directory", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-env-cwd-"));
    fs.writeFileSync(path.join(cwd, ".env"), [
      "# local service context",
      `OTHER_KEY=ignored`,
      ` OCTOBUS_SERVICE_CONTEXT = '{"config":{"label":"dotenv"},"secret":{"apiToken":"dotenv-secret"}}' `,
      "",
    ].join("\n"), "utf8");
    const seen: Record<string, unknown> = {};
    const stdout = writableBuffer();
    await expect(runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          seen.config = ctx.config;
          seen.secret = ctx.secret;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["add", "--data-json", `{"left":3,"right":4}`],
      cwd,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
    })).resolves.toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/Add" });

    expect(JSON.parse(stdout.data())).toEqual({ result: 7 });
    expect(seen).toEqual({
      config: { label: "dotenv" },
      secret: { apiToken: "dotenv-secret" },
    });
  });

  it("service cli gives real env precedence over .env and .env precedence over CLI flags", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-env-precedence-"));
    fs.writeFileSync(path.join(cwd, ".env"), `OCTOBUS_SERVICE_CONTEXT='{"config":{"label":"dotenv"},"secret":{"apiToken":"dotenv-secret"}}'\n`, "utf8");
    fs.writeFileSync(path.join(cwd, "config.json"), `{"label":"cli"}`, "utf8");
    fs.writeFileSync(path.join(cwd, "secret.json"), `{"apiToken":"cli-secret"}`, "utf8");

    const dotenvSeen: Record<string, unknown> = {};
    await expect(runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          dotenvSeen.config = ctx.config;
          dotenvSeen.secret = ctx.secret;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["add", "--data-json", `{"left":1,"right":1}`, "--config", "config.json", "--secret", "secret.json"],
      cwd,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
    })).resolves.toMatchObject({ command: "cli" });
    expect(dotenvSeen).toEqual({
      config: { label: "dotenv" },
      secret: { apiToken: "dotenv-secret" },
    });

    const envSeen: Record<string, unknown> = {};
    await expect(runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          envSeen.config = ctx.config;
          envSeen.secret = ctx.secret;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["add", "--data-json", `{"left":1,"right":1}`, "--config", "config.json", "--secret", "secret.json"],
      cwd,
      env: {
        OCTOBUS_PACKAGE_DIR: fixturesDir,
        OCTOBUS_SERVICE_CONTEXT: `{"config":{"label":"env"},"secret":{"apiToken":"env-secret"}}`,
      },
      stdout: writableBuffer(),
    })).resolves.toMatchObject({ command: "cli" });
    expect(envSeen).toEqual({
      config: { label: "env" },
      secret: { apiToken: "env-secret" },
    });
  });

  it("service cli falls back to CLI fields independently when service context omits fields", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-env-field-fallback-"));
    fs.writeFileSync(path.join(cwd, "config.json"), `{"label":"cli"}`, "utf8");
    fs.writeFileSync(path.join(cwd, "secret.json"), `{"apiToken":"cli-secret"}`, "utf8");
    const seen: Record<string, unknown> = {};

    await expect(runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          seen.config = ctx.config;
          seen.secret = ctx.secret;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["add", "--data-json", `{"left":1,"right":1}`, "--config", "config.json", "--secret", "secret.json"],
      cwd,
      env: {
        OCTOBUS_PACKAGE_DIR: fixturesDir,
        OCTOBUS_SERVICE_CONTEXT: `{"secret":null}`,
      },
      stdout: writableBuffer(),
    })).resolves.toMatchObject({ command: "cli" });

    expect(seen).toEqual({
      config: { label: "cli" },
      secret: null,
    });
  });

  it("service cli reads .env only from current directory and not package root or --workdir", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-env-current-cwd-"));
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-env-workdir-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-env-package-"));
    copyFixturePackage(packageRoot);
    fs.writeFileSync(path.join(packageRoot, ".env"), `OCTOBUS_SERVICE_CONTEXT='{"config":{"label":"package-root"}}'\n`, "utf8");
    fs.writeFileSync(path.join(workdir, ".env"), `OCTOBUS_SERVICE_CONTEXT='{"config":{"label":"workdir"}}'\n`, "utf8");
    fs.writeFileSync(path.join(cwd, ".env"), `OCTOBUS_SERVICE_CONTEXT='{"config":{"label":"current"},"secret":{"apiToken":"current-secret"}}'\n`, "utf8");
    const seen: Record<string, unknown> = {};

    await expect(runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          seen.config = ctx.config;
          seen.secret = ctx.secret;
          seen.workdir = ctx.workdir;
          seen.packageDir = ctx.packageDir;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["add", "--data-json", `{"left":4,"right":5}`],
      cwd,
      env: { OCTOBUS_PACKAGE_DIR: packageRoot },
      entryFile: path.join(packageRoot, "calculator-handler.js"),
      stdout: writableBuffer(),
    })).resolves.toMatchObject({ command: "cli" });

    expect(seen).toMatchObject({
      config: { label: "current" },
      secret: { apiToken: "current-secret" },
      workdir: cwd,
      packageDir: packageRoot,
    });

    const devSeen: Record<string, unknown> = {};
    const dev = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          devSeen.config = ctx.config;
          devSeen.secret = ctx.secret;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "dev", "--host", "127.0.0.1", "--port", "0", "--workdir", workdir],
      cwd,
      env: { OCTOBUS_PACKAGE_DIR: packageRoot },
      entryFile: path.join(packageRoot, "calculator-handler.js"),
      stdout: writableBuffer(),
    });
    if (dev.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = dev.server;
    const calculator = createClient(dev.address, path.join(packageRoot, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });
    await expect(unary<{ result: number }>(calculator, "Add", { left: 1, right: 2 })).resolves.toMatchObject({ result: 3 });
    expect(devSeen).toEqual({
      config: { label: "current" },
      secret: { apiToken: "current-secret" },
    });
  });

  it("service cli ignores .env files from package root and --workdir when current directory has none", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-env-empty-cwd-"));
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-env-ignored-workdir-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-env-ignored-package-"));
    copyFixturePackage(packageRoot);
    fs.writeFileSync(path.join(packageRoot, ".env"), `OCTOBUS_SERVICE_CONTEXT='{"config":{"label":"package-root"},"secret":{"apiToken":"package-secret"}}'\n`, "utf8");
    fs.writeFileSync(path.join(workdir, ".env"), `OCTOBUS_SERVICE_CONTEXT='{"config":{"label":"workdir"},"secret":{"apiToken":"workdir-secret"}}'\n`, "utf8");

    const cliSeen: Record<string, unknown> = {};
    await expect(runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          cliSeen.config = ctx.config;
          cliSeen.secret = ctx.secret;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["add", "--data-json", `{"left":1,"right":2}`],
      cwd,
      env: { OCTOBUS_PACKAGE_DIR: packageRoot },
      entryFile: path.join(packageRoot, "calculator-handler.js"),
      stdout: writableBuffer(),
    })).resolves.toMatchObject({ command: "cli" });
    expect(cliSeen).toEqual({ config: {}, secret: {} });

    const devSeen: Record<string, unknown> = {};
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          devSeen.config = ctx.config;
          devSeen.secret = ctx.secret;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["--runtime", "dev", "--host", "127.0.0.1", "--port", "0", "--workdir", workdir],
      cwd,
      env: { OCTOBUS_PACKAGE_DIR: packageRoot },
      entryFile: path.join(packageRoot, "calculator-handler.js"),
      stdout: writableBuffer(),
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;
    const calculator = createClient(result.address, path.join(packageRoot, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService;
    });
    await expect(unary<{ result: number }>(calculator, "Add", { left: 1, right: 2 })).resolves.toMatchObject({ result: 3 });
    expect(devSeen).toEqual({ config: {}, secret: {} });
  });

  it("service cli prints protobuf Value fields as plain JSON", async () => {
    const stdout = writableBuffer();
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/EchoContract": () => ({
          httpStatusCode: 200,
          httpResponse: {
            success: true,
            data: { total: 1 },
          },
          object: { state: "ready" },
          list: [1, "x"],
        }),
      },
    }), {
      argv: ["echo-contract", "--data-json", `{"count":1,"bigCount":"9007199254740993","numbers":[1,2],"payload":{"label":"ok"}}`],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
    });

    expect(result).toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/EchoContract" });
    expect(JSON.parse(stdout.data())).toEqual({
      httpStatusCode: 200,
      httpResponse: {
        success: true,
        data: {
          total: 1,
        },
      },
      object: {
        state: "ready",
      },
      list: [1, "x"],
    });
    expect(stdout.data()).not.toContain("structValue");
    expect(stdout.data()).not.toContain("fields");
    expect(stdout.data()).not.toContain("kind");
  });

  it("service cli prints standard ProtoJSON shapes and custom json_name fields", async () => {
    let seenRequest: unknown;
    const stdout = writableBuffer();
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/JsonShape": (ctx) => {
          seenRequest = ctx.request;
          return {
            createdAt: { seconds: 1_704_067_200, nanos: 123_000_000 },
            elapsed: { seconds: 5, nanos: 250_000_000 },
            mask: { paths: ["custom_field", "created_at"] },
            label: "ready",
            total: "9007199254740993",
            raw: Buffer.from("ok"),
            status: 1,
            tags: { source: "integration" },
            children: [{ childName: "first" }],
            childMap: { a: { childName: "mapped" } },
            customField: "custom",
          };
        },
      },
    }), {
      argv: ["json-shape", "--data-json", `{"requestId":"req-1","nested":{"childName":"input"}}`],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
    });

    expect(result).toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/JsonShape" });
    expect(seenRequest).toMatchObject({
      requestId: "req-1",
      nested: {
        childName: "input",
      },
    });
    expect(JSON.parse(stdout.data())).toEqual({
      createdAt: "2024-01-01T00:00:00.123Z",
      elapsed: "5.250s",
      mask: "customField,createdAt",
      label: "ready",
      total: "9007199254740993",
      raw: "b2s=",
      status: "JSON_SHAPE_STATUS_READY",
      tags: { source: "integration" },
      children: [{ childName: "first" }],
      childMapAlias: { a: { childName: "mapped" } },
      customAlias: "custom",
    });
  });

  it("service cli validates request JSON before protobuf serialization", async () => {
    const service = defineService({
      handlers: {
        "calculator.v1.CalculatorService/EchoContract": () => {
          throw new Error("handler should not be called");
        },
      },
    });

    const unknownField = await captureServiceCliError(service, ["echo-contract", "--data-json", `{"count":1,"extra":3}`]);
    expect(unknownField.stderr).toContain(`INVALID_ARGUMENT: cannot decode message calculator.v1.ContractRequest from JSON: key "extra" is unknown`);
    expect(unknownField.stderr).not.toContain("handler should not be called");

    const invalidInt32 = await captureServiceCliError(service, ["echo-contract", "--data-json", `{"count":"abc"}`]);
    expect(invalidInt32.stderr).toContain("INVALID_ARGUMENT: cannot decode field calculator.v1.ContractRequest.count from JSON");
    expect(invalidInt32.stderr).toContain("expected number");
    expect(invalidInt32.stderr).toContain(`got "abc"`);

    const invalidRepeated = await captureServiceCliError(service, ["echo-contract", "--data-json", `{"numbers":[1,"abc"]}`]);
    expect(invalidRepeated.stderr).toContain("INVALID_ARGUMENT: cannot decode field calculator.v1.ContractRequest.numbers from JSON");
    expect(invalidRepeated.stderr).toContain("expected number");
    expect(invalidRepeated.stderr).toContain(`got "abc"`);

    const int64StringStdout = writableBuffer();
    await expect(runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/EchoContract": (ctx) => {
          expect(ctx.request).toMatchObject({ bigCount: 9007199254740993n });
          return { httpStatusCode: 200 };
        },
      },
    }), {
      argv: ["echo-contract", "--data-json", `{"bigCount":"9007199254740993"}`],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: int64StringStdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/EchoContract" });
    expect(JSON.parse(int64StringStdout.data())).toMatchObject({ httpStatusCode: 200 });
  });

  it("service cli reports bad JSON without a stack trace", async () => {
    const captured = await captureServiceCliError(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => ({ result: 1 }),
      },
    }), ["add", "--data-json", "not-json"]);

    expect(captured.stderr).toContain("INVALID_ARGUMENT: --data-json is not valid JSON");
    expect(captured.stderr).not.toContain("at readCliRequest");
    expect(captured.stderr).not.toContain("SyntaxError");
  });

  it("service cli reports invalid OCTOBUS_SERVICE_CONTEXT values clearly without leaking secret values", async () => {
    const service = defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => ({ result: 1 }),
      },
    });

    const invalidJson = await captureServiceCliError(service, ["add", "--data-json", `{"left":1,"right":2}`], {
      OCTOBUS_SERVICE_CONTEXT: `{"secret":{"apiToken":"top-secret"}`,
    });
    expect(invalidJson.stderr).toContain("INVALID_ARGUMENT: OCTOBUS_SERVICE_CONTEXT is not valid JSON");
    expect(invalidJson.stderr).not.toContain("top-secret");

    const notObject = await captureServiceCliError(service, ["add", "--data-json", `{"left":1,"right":2}`], {
      OCTOBUS_SERVICE_CONTEXT: `[]`,
    });
    expect(notObject.stderr).toContain("INVALID_ARGUMENT: OCTOBUS_SERVICE_CONTEXT must be a JSON object");

    const unknownField = await captureServiceCliError(service, ["add", "--data-json", `{"left":1,"right":2}`], {
      OCTOBUS_SERVICE_CONTEXT: `{"secrets":{"apiToken":"top-secret"}}`,
    });
    expect(unknownField.stderr).toContain(`INVALID_ARGUMENT: OCTOBUS_SERVICE_CONTEXT contains unsupported field "secrets"`);
    expect(unknownField.stderr).not.toContain("top-secret");
  });

  it("service cli ignores current-directory .env when it is a directory", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-dir-env-"));
    fs.mkdirSync(path.join(cwd, ".env"));
    const stdout = writableBuffer();

    await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => ({ result: 1 }),
      },
    }), {
      argv: ["add", "--data-json", `{"left":1,"right":2}`],
      cwd,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
      stderr: writableBuffer(),
    });

    expect(JSON.parse(stdout.data())).toEqual({ result: 1 });
  });

  it("runtime serve and invoke do not read OCTOBUS_SERVICE_CONTEXT", async () => {
    await expect(runService(calculatorService, {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0"],
      cwd: fixturesDir,
      env: {
        OCTOBUS_PACKAGE_DIR: fixturesDir,
        OCTOBUS_SERVICE_CONTEXT: `{"config":{"label":"env"}}`,
      },
      stdout: writableBuffer(),
      stderr: writableBuffer(),
    })).rejects.toThrow("serve requires --config or --config-json");

    const metadataPath = writeJSONFile("metadata", {});
    const stderr = writableBuffer();
    await expect(runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => {
          throw new Error("handler should not be called");
        },
      },
    }), {
      argv: ["--runtime", "invoke", "--method", "calculator.v1.CalculatorService/Add", "--metadata", metadataPath, "--workdir", path.dirname(metadataPath)],
      cwd: fixturesDir,
      env: {
        OCTOBUS_PACKAGE_DIR: fixturesDir,
        OCTOBUS_SERVICE_CONTEXT: `{"config":{"label":"env"}}`,
      },
      stdin: readableBuffer(Buffer.alloc(0)),
      stdout: writableBuffer(),
      stderr,
    })).rejects.toThrow("invoke requires --config");
    expect(stderr.data()).toBe("");
  });

  it("service cli prints method contract JSON for method help", async () => {
    const stdout = writableBuffer();
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => ({ result: 1 }),
      },
    }), {
      argv: ["add", "--help"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
    });

    expect(result.command).toBe("cli");
    expect(result.method).toBe("calculator.v1.CalculatorService/Add");
    const contract = JSON.parse(stdout.data());
    expect(contract).toMatchObject({
      command: "add",
      method: "calculator.v1.CalculatorService/Add",
      description: "Add two numbers",
      input: {
        title: "calculator.v1.BinaryOperationRequest",
        properties: {
          left: { type: "number" },
          right: { type: "number" },
        },
      },
      output: {
        title: "calculator.v1.CalculatorResponse",
        properties: {
          result: { type: "number" },
        },
      },
      environment: {
        OCTOBUS_SERVICE_CONTEXT: {
          description: "JSON object with optional config and secret fields. Also read from .env in the current directory.",
          shape: {
            config: {},
            secret: {},
          },
          precedence: "environment value overrides matching --config* and --secret* CLI options",
        },
      },
    });
  });

  it("service cli prints permissive well-known type schemas and package examples", async () => {
    const stdout = writableBuffer();
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/EchoContract": () => ({ httpStatusCode: 200 }),
      },
    }), {
      argv: ["echo-contract", "--help"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
    });

    expect(result).toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/EchoContract" });
    const contract = JSON.parse(stdout.data());
    expect(contract.input.properties.payload).toEqual({ description: "Arbitrary JSON value" });
    expect(contract.output.properties.httpResponse).toEqual({ description: "Arbitrary JSON value" });
    expect(contract.output.properties.object).toMatchObject({
      type: "object",
      description: "Arbitrary JSON object",
      additionalProperties: true,
    });
    expect(contract.output.properties.list).toMatchObject({
      type: "array",
      description: "Arbitrary JSON array",
    });
    expect(contract.input.properties.extraFields).toEqual({
      type: "object",
      additionalProperties: {
        type: "string",
      },
    });
    expect(contract.examples).toEqual([
      {
        description: "Echo a full contract request",
        argv: [
          "echo-contract",
          "--data-json",
          `{"count":1,"bigCount":"9007199254740993","numbers":[1,2],"payload":{"label":"ok"},"extraFields":{"source":"agent"}}`,
        ],
      },
    ]);
  });

  it("service cli keeps method contract JSON Schema for ProtoJSON output methods", async () => {
    const stdout = writableBuffer();
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/JsonShape": () => ({}),
      },
    }), {
      argv: ["json-shape", "--help"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
    });

    expect(result).toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/JsonShape" });
    const contract = JSON.parse(stdout.data());
    expect(contract.input.properties).toMatchObject({
      requestId: { type: "string" },
      nested: { type: "object" },
    });
    expect(contract.output.properties).toMatchObject({
      createdAt: { type: "string", format: "date-time" },
      elapsed: { type: "string" },
      mask: { type: "string" },
      label: { type: "string" },
      total: { type: "string" },
      raw: { type: "string", contentEncoding: "base64" },
      status: { type: "string" },
      tags: {
        type: "object",
        additionalProperties: { type: "string" },
      },
      children: {
        type: "array",
        items: { type: "object" },
      },
      childMapAlias: {
        type: "object",
        additionalProperties: { type: "object" },
      },
      customAlias: { type: "string" },
    });
  });

  it("service cli accepts protobuf JSON objects for map fields", async () => {
    let seenRequest: unknown;
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/EchoContract": (ctx) => {
          seenRequest = ctx.request;
          return { httpStatusCode: 200 };
        },
      },
    }), {
      argv: ["echo-contract", "--data-json", `{"count":1,"extraFields":{"source":"agent","operator":"bot"}}`],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
    });

    expect(result).toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/EchoContract" });
    expect(seenRequest).toMatchObject({
      count: 1,
      extraFields: {
        source: "agent",
        operator: "bot",
      },
    });
  });

  it("service cli validates protobuf map values", async () => {
    const captured = await captureServiceCliError(defineService({
      handlers: {
        "calculator.v1.CalculatorService/EchoContract": () => ({ httpStatusCode: 200 }),
      },
    }), ["echo-contract", "--data-json", `{"extraFields":{"source":123}}`]);

    expect(captured.stderr).toContain("INVALID_ARGUMENT: cannot decode field calculator.v1.ContractRequest.extra_fields from JSON");
    expect(captured.stderr).toContain(`map entry "source": expected string, got 123`);
  });

  it("service cli lists implemented unary commands and allows call as a method alias", async () => {
    const helpStdout = writableBuffer();
    await expect(runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => ({ result: 1 }),
        "calculator.v1.CalculatorService/Subtract": () => ({ result: 2 }),
        "calculator.v1.CalculatorService/Sum": () => ({ result: 3 }),
      },
    }), {
      argv: ["--help"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: helpStdout,
    })).resolves.toMatchObject({ command: "cli" });

    expect(helpStdout.data()).toContain("add");
    expect(helpStdout.data()).toContain("call");
    expect(helpStdout.data()).toContain("Environment:");
    expect(helpStdout.data()).toContain("OCTOBUS_SERVICE_CONTEXT");
    expect(helpStdout.data()).toContain("Also read from .env in the current directory.");
    expect(helpStdout.data()).toContain("Example: {\"config\":{},\"secret\":{}}");
    expect(helpStdout.data()).toContain("Matching fields override --config* and --secret*.");
    expect(helpStdout.data()).not.toContain("sum");

    const callStdout = writableBuffer();
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Subtract": (ctx) => {
          const request = ctx.request as { left: number; right: number };
          return { result: request.left - request.right };
        },
      },
    }), {
      argv: ["call", "--data-json", `{"left":8,"right":5}`],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: callStdout,
    });

    expect(result).toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/Subtract" });
    expect(JSON.parse(callStdout.data())).toEqual({ result: 3 });
  });

  it("service cli reads request JSON from stdin and discovers package root from entry file", async () => {
    const stdout = writableBuffer();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-npx-cwd-"));
    const entryFile = path.join(fixturesDir, "calculator-handler.js");
    const result = await runService(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          const request = ctx.request as { left: number; right: number };
          expect(ctx.workdir).toBe(cwd);
          expect(ctx.packageDir).toBe(fixturesDir);
          return { result: request.left + request.right };
        },
      },
    }), {
      argv: ["add", "--data", "-"],
      cwd,
      env: {},
      entryFile,
      stdin: readableBuffer(Buffer.from(`{"left":2,"right":9}`)),
      stdout,
    });

    expect(result).toMatchObject({ command: "cli", method: "calculator.v1.CalculatorService/Add" });
    expect(JSON.parse(stdout.data())).toEqual({ result: 11 });
  });

  it("prints client stubs from service package runtime commands without invoking handlers", async () => {
    const service = defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => {
          throw new Error("client generation must not invoke service handlers");
        },
      },
    });

    const connectStdout = writableBuffer();
    await expect(runService(service, {
      argv: ["--runtime", "client-stub", "--transport", "connect", "--factory", "createRuntimeConnectClient"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: connectStdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "client-stub", transport: "connect" });
    expect(connectStdout.data()).toContain("export function createRuntimeConnectClient(options)");
    expect(connectStdout.data()).toContain("createConnectRpcStub");
    expect(connectStdout.data()).toContain("calculator.v1.CalculatorService/Add");

    const grpcStdout = writableBuffer();
    await expect(runService(service, {
      argv: ["--runtime", "client-stub", "--transport", "grpc", "--factory", "createRuntimeGrpcClient"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: grpcStdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "client-stub", transport: "grpc" });
    expect(grpcStdout.data()).toContain("export function createRuntimeGrpcClient(options)");
    expect(grpcStdout.data()).toContain("createGrpcStub");
    expect(grpcStdout.data()).toContain("calculator.v1.CalculatorService/Sum");
  });

  it("generates descriptor-backed client packages from service package runtime commands", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-runtime-client-"));
    const stdout = writableBuffer();
    await expect(runService(defineService({ handlers: {} }), {
      argv: [
        "--runtime",
        "client-package",
        "--transport",
        "grpc",
        "--name",
        "@acme/runtime-calculator-client",
        "--out",
        outDir,
        "--factory",
        "createRuntimeCalculatorClient",
      ],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({
      command: "client-package",
      transport: "grpc",
      outDir,
      bundled: false,
      published: false,
    });

    expect(stdout.data()).toContain(`generated grpc client package at ${outDir}`);
    expect(fs.existsSync(path.join(outDir, "descriptors", "descriptor.pb"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "descriptors", "service.json"), "utf8"))).toMatchObject({
      name: "calculator",
    });
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8"))).toMatchObject({
      name: "@acme/runtime-calculator-client",
      dependencies: {
        "@chaitin-ai/octobus-sdk": "*",
        "@grpc/grpc-js": "^1.13.4",
      },
    });
    expect(fs.readFileSync(path.join(outDir, "index.js"), "utf8")).toContain("export function createRuntimeCalculatorClient(options)");
    expect(fs.readFileSync(path.join(outDir, "index.d.ts"), "utf8")).toContain("export interface CalculatorServiceClient");
  });

  it("validates runtime client generation arguments consistently with SDK commands", async () => {
    const invalidTransport = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--runtime", "client-stub", "--transport", "http"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr: invalidTransport,
    })).rejects.toThrow("client-stub --transport must be connect or grpc");
    expect(invalidTransport.data()).toBe("");

    const invalidFactory = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--runtime", "client-stub", "--transport", "connect", "--factory", "Bad Name"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr: invalidFactory,
    })).rejects.toThrow("client-stub --factory");
    expect(invalidFactory.data()).toBe("");

    const invalidPackageName = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--runtime", "client-package", "--transport", "connect", "--name", "Bad Name", "--out", "client"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr: invalidPackageName,
    })).rejects.toThrow("is not a valid npm package name");
    expect(invalidPackageName.data()).toBe("");

    const nonEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-runtime-nonempty-client-"));
    fs.writeFileSync(path.join(nonEmptyDir, "keep.txt"), "keep", "utf8");
    const nonEmpty = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--runtime", "client-package", "--transport", "connect", "--name", "@acme/runtime-client", "--out", nonEmptyDir],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr: nonEmpty,
    })).rejects.toThrow("is not empty; pass --force");
    expect(nonEmpty.data()).toBe("");
  });

  it("runtime client generation discovers the package root from the service entry file", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-runtime-entry-cwd-"));
    const stdout = writableBuffer();
    await expect(runService(defineService({ handlers: {} }), {
      argv: ["--runtime", "client-stub", "--transport", "connect"],
      cwd,
      env: {},
      entryFile: path.join(fixturesDir, "calculator-handler.js"),
      stdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "client-stub", transport: "connect" });
    expect(stdout.data()).toContain("calculator.v1.CalculatorService/Add");
  });

  it("runs package-level SDK validate and inspect commands", async () => {
    const validateStdout = writableBuffer();
    const validateStderr = writableBuffer();
    await expect(runSdkCli({
      argv: ["validate"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: validateStdout,
      stderr: validateStderr,
    })).resolves.toBe(0);
    expect(validateStdout.data()).toContain("service package is valid");
    expect(validateStdout.data()).toContain("entry: calculator-handler.js");
    expect(validateStderr.data()).toBe("");

    const inspectStdout = writableBuffer();
    await expect(runSdkCli({
      argv: ["inspect"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: inspectStdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(JSON.parse(inspectStdout.data())).toMatchObject({ name: "calculator" });

    const inspectYamlStdout = writableBuffer();
    await expect(runSdkCli({
      argv: ["inspect", "--yaml"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: inspectYamlStdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(inspectYamlStdout.data()).toContain("name: calculator");

    const configSchemaStdout = writableBuffer();
    await expect(runSdkCli({
      argv: ["inspect", "--config-schema"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: configSchemaStdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(JSON.parse(configSchemaStdout.data())).toMatchObject({
      type: "object",
      properties: {
        label: { type: "string" },
      },
    });

    const secretSchemaStdout = writableBuffer();
    await expect(runSdkCli({
      argv: ["inspect", "--secret-schema", "--yaml"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: secretSchemaStdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(secretSchemaStdout.data()).toContain("apiToken:");

    const rootHelpStdout = writableBuffer();
    await expect(runSdkCli({
      argv: [],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: rootHelpStdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(rootHelpStdout.data()).toContain("Usage: octobus-sdk");

    const explicitRootHelpStdout = writableBuffer();
    await expect(runSdkCli({
      argv: ["--help"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: explicitRootHelpStdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(explicitRootHelpStdout.data()).toContain("Usage: octobus-sdk");

    const validateHelpStdout = writableBuffer();
    await expect(runSdkCli({
      argv: ["validate", "--help"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: validateHelpStdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(validateHelpStdout.data()).toContain("Usage: octobus-sdk validate");

    const helpStdout = writableBuffer();
    await expect(runSdkCli({
      argv: ["inspect", "--help"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: helpStdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(helpStdout.data()).toContain("Usage: octobus-sdk inspect");
    expect(helpStdout.data()).toContain("--config-schema");
    expect(helpStdout.data()).toContain("--secret-schema");
  });

  it("prints schema files from a service package runtime inspect command", async () => {
    const configSchemaStdout = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--runtime", "inspect", "--config-schema"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: configSchemaStdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "inspect" });
    expect(JSON.parse(configSchemaStdout.data())).toMatchObject({
      type: "object",
      properties: {
        label: { type: "string" },
      },
    });

    const secretSchemaStdout = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--runtime", "inspect", "--secret-schema"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: secretSchemaStdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "inspect" });
    expect(JSON.parse(secretSchemaStdout.data())).toMatchObject({
      properties: {
        apiToken: { type: "string" },
      },
    });
  });

  it("uses the service package bin name in runtime help from the package directory", async () => {
    const cliHelpStdout = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--help"],
      cwd: fixturesDir,
      env: {},
      stdout: cliHelpStdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "cli" });
    expect(cliHelpStdout.data()).toContain("Usage: calculator");

    const rootHelpStdout = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--runtime"],
      cwd: fixturesDir,
      env: {},
      stdout: rootHelpStdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "help" });
    expect(rootHelpStdout.data()).toContain("Usage: calculator");
    expect(rootHelpStdout.data()).not.toContain("Usage: octobus-service");

    const inspectHelpStdout = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--runtime", "inspect", "--help"],
      cwd: fixturesDir,
      env: {},
      stdout: inspectHelpStdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "help" });
    expect(inspectHelpStdout.data()).toContain("Usage: calculator inspect");
  });

  it("uses the service package bin name in runtime help from the entry file", async () => {
    const stdout = writableBuffer();
    await expect(runService(calculatorService, {
      argv: ["--runtime", "--help"],
      cwd: os.tmpdir(),
      env: {},
      entryFile: path.join(fixturesDir, "calculator-handler.js"),
      stdout,
      stderr: writableBuffer(),
    })).resolves.toMatchObject({ command: "help" });
    expect(stdout.data()).toContain("Usage: calculator");
    expect(stdout.data()).not.toContain("Usage: octobus-service");
  });

  it("reports missing schema declarations without printing secret values", async () => {
    const packageDir = copyFixturePackageWithoutVersion();
    const stderr = writableBuffer();
    await expect(runSdkCli({
      argv: ["inspect", "--secret-schema"],
      cwd: packageDir,
      env: { OCTOBUS_PACKAGE_DIR: packageDir },
      stdout: writableBuffer(),
      stderr,
    })).resolves.toBe(1);
    expect(stderr.data()).toContain("service.json does not define secretSchema");
    expect(stderr.data()).not.toContain("apiToken");
  });

  it("rejects schema paths outside the service package", async () => {
    const packageDir = copyFixturePackageWithoutVersion();
    const serviceJsonPath = path.join(packageDir, "service.json");
    const manifest = JSON.parse(fs.readFileSync(serviceJsonPath, "utf8")) as Record<string, unknown>;
    manifest.configSchema = "../config.schema.json";
    fs.writeFileSync(serviceJsonPath, JSON.stringify(manifest), "utf8");

    const stderr = writableBuffer();
    await expect(runSdkCli({
      argv: ["inspect", "--config-schema"],
      cwd: packageDir,
      env: { OCTOBUS_PACKAGE_DIR: packageDir },
      stdout: writableBuffer(),
      stderr,
    })).resolves.toBe(1);
    expect(stderr.data()).toContain("service.json configSchema must stay inside the package");
  });

  it("invoke maps GrpcError, ordinary Error, and missing handlers to OCTOBUS_ERROR", async () => {
    const configPath = writeConfig({});
    const metadataPath = writeJSONFile("metadata", {});
    const request = serializeMessage(path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService.service.Add.requestSerialize({ left: -1, right: 0 });
    });

    const grpcError = await captureInvokeError(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => {
          throw new GrpcError(status.PERMISSION_DENIED, "fixture denied");
        },
      },
    }), configPath, metadataPath, request);
    expect(grpcError).toContain(`OCTOBUS_ERROR:{"code":"PERMISSION_DENIED","message":"fixture denied"}`);

    const ordinaryError = await captureInvokeError(defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => {
          throw new Error("ordinary failure");
        },
      },
    }), configPath, metadataPath, request);
    expect(ordinaryError).toContain(`OCTOBUS_ERROR:{"code":"INTERNAL","message":"ordinary failure"}`);

    const unimplemented = await captureInvokeError(defineService({ handlers: {} }), configPath, metadataPath, request);
    expect(unimplemented).toContain(`OCTOBUS_ERROR:{"code":"UNIMPLEMENTED","message":"method calculator.v1.CalculatorService/Add is not implemented by package calculator@0.1.0"}`);
  });

  it("invoke maps bad protobuf input and unavailable methods to OCTOBUS_ERROR", async () => {
    const configPath = writeConfig({});
    const metadataPath = writeJSONFile("metadata", {});
    const service = defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => ({ result: 1 }),
        "calculator.v1.CalculatorService/Sum": () => ({ result: 2 }),
      },
    });

    const decodeError = await captureInvokeError(service, configPath, metadataPath, Buffer.from([0xff]));
    expect(decodeError).toContain(`OCTOBUS_ERROR:{"code":"INTERNAL"`);

    const request = serializeMessage(path.join(fixturesDir, "proto", "calculator.proto"), (grpcObject) => {
      return grpcObject.calculator.v1.CalculatorService.service.Add.requestSerialize({ left: 1, right: 2 });
    });
    const unknown = await captureInvokeErrorForMethod(service, "calculator.v1.CalculatorService/Missing", configPath, metadataPath, request);
    expect(unknown).toContain(`OCTOBUS_ERROR:{"code":"UNIMPLEMENTED","message":"method calculator.v1.CalculatorService/Missing is not implemented by package calculator@0.1.0"}`);

    const streaming = await captureInvokeErrorForMethod(service, "calculator.v1.CalculatorService/Sum", configPath, metadataPath, request);
    expect(streaming).toContain(`OCTOBUS_ERROR:{"code":"UNIMPLEMENTED","message":"method calculator.v1.CalculatorService/Sum is not implemented by package calculator@0.1.0"}`);
  });
});

function createClient(address: string, protoPath: string, selectClient: (grpcObject: any) => any): any {
  const Client = selectClient(createFixtureGrpcObject(protoPath));
  return new Client(address, grpc.credentials.createInsecure());
}

function unary<T>(client: any, method: string, request: unknown, metadata = new grpc.Metadata()): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](request, metadata, (error: grpc.ServiceError | null, response: T) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stripTypeNames(response) as T);
    });
  });
}

function clientStreaming<T>(client: any, method: string, requests: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const call = client[method]((error: grpc.ServiceError | null, response: T) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stripTypeNames(response) as T);
    });
    for (const request of requests) {
      call.write(request);
    }
    call.end();
  });
}

function serverStreaming<T>(client: any, method: string, request: unknown, metadata = new grpc.Metadata()): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const responses: T[] = [];
    const call = client[method](request, metadata);
    call.on("data", (response: T) => responses.push(stripTypeNames(response) as T));
    call.on("error", reject);
    call.on("end", () => resolve(responses));
  });
}

function bidiStreaming<T>(client: any, method: string, requests: unknown[], expectedResponses = requests.length): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const responses: T[] = [];
    const call = client[method]();
    let nextRequest = 0;
    const writeNext = () => {
      if (nextRequest >= requests.length) {
        call.end();
        return;
      }
      call.write(requests[nextRequest]);
      nextRequest += 1;
    };
    call.on("data", (response: T) => {
      responses.push(stripTypeNames(response) as T);
      if (responses.length === expectedResponses) {
        resolve(responses);
        call.end();
        return;
      }
      writeNext();
    });
    call.on("error", reject);
    call.on("status", (statusObject: grpc.StatusObject) => {
      if (statusObject.code === status.OK) {
        resolve(responses);
        return;
      }
      reject(Object.assign(new Error(statusObject.details), statusObject));
    });
    writeNext();
  });
}

function serializeMessage(protoPath: string, fn: (grpcObject: any) => Buffer): Buffer {
  return fn(createFixtureGrpcObject(protoPath));
}

function deserializeCalculatorResponse(data: Buffer): any {
  const grpcObject = createFixtureGrpcObject(path.join(fixturesDir, "proto", "calculator.proto"));
  return grpcObject.calculator.v1.CalculatorService.service.Add.responseDeserialize(data);
}

function createFixtureGrpcObject(protoPath: string): any {
  if (path.basename(protoPath) === "health.proto") {
    const Health = grpc.makeGenericClientConstructor(healthServiceDefinition, "grpc.health.v1.Health");
    return { grpc: { health: { v1: { Health } } } };
  }

  const packageDir = findFixturePackageDir(protoPath);
  const loaded = loadServicePackage(packageDir);
  const calculator = loaded.grpcServices.find((service) => service.descriptor.typeName === "calculator.v1.CalculatorService");
  if (!calculator) {
    throw new Error(`calculator fixture service not found from ${protoPath}`);
  }
  const CalculatorService = grpc.makeGenericClientConstructor(calculator.definition, calculator.descriptor.typeName);
  return { calculator: { v1: { CalculatorService } } };
}

function findFixturePackageDir(protoPath: string): string {
  let current = path.dirname(protoPath);
  while (true) {
    if (fs.existsSync(path.join(current, "service.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`service.json not found for ${protoPath}`);
    }
    current = parent;
  }
}

function readableBuffer(data: Buffer): NodeJS.ReadableStream {
  const stream = new PassThrough();
  stream.end(data);
  return stream;
}

function writableBuffer(): Writable & { buffer: () => Buffer; data: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  }) as Writable & { buffer: () => Buffer; data: () => string };
  stream.buffer = () => Buffer.concat(chunks);
  stream.data = () => stream.buffer().toString("utf8");
  return stream;
}

function stripTypeNames(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripTypeNames);
  }
  if (!value || typeof value !== "object" || Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== "$typeName") {
      output[key] = stripTypeNames(item);
    }
  }
  return output;
}

async function captureInvokeError(service: ReturnType<typeof defineService>, configPath: string, metadataPath: string, request: Buffer): Promise<string> {
  return captureInvokeErrorForMethod(service, "calculator.v1.CalculatorService/Add", configPath, metadataPath, request);
}

async function captureInvokeErrorForMethod(service: ReturnType<typeof defineService>, method: string, configPath: string, metadataPath: string, request: Buffer): Promise<string> {
  const stderr = writableBuffer();
  await expect(runService(service, {
    argv: ["--runtime", "invoke", "--method", method, "--config", configPath, "--metadata", metadataPath, "--workdir", path.dirname(configPath)],
    cwd: fixturesDir,
    env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
    stdin: readableBuffer(request),
    stdout: writableBuffer(),
    stderr,
  })).rejects.toThrow("");
  return stderr.data();
}

async function captureServiceCliError(
  service: ReturnType<typeof defineService>,
  argv: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ stderr: string }> {
  const stderr = writableBuffer();
  await expect(runService(service, {
    argv,
    cwd: fixturesDir,
    env: { OCTOBUS_PACKAGE_DIR: fixturesDir, ...env },
    stdout: writableBuffer(),
    stderr,
  })).rejects.toThrow("");
  return { stderr: stderr.data() };
}

function writeConfig(config: unknown): string {
  return writeJSONFile("config", config);
}

function writeJSONFile(name: string, value: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-integration-"));
  const filePath = path.join(dir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
  return filePath;
}

function copyFixturePackage(outDir: string): void {
  fs.cpSync(fixturesDir, outDir, {
    recursive: true,
    filter: (source) => path.basename(source) !== "node_modules",
  });
}

function copyFixturePackageWithoutVersion(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-no-version-"));
  fs.mkdirSync(path.join(dir, "proto"));
  fs.copyFileSync(path.join(fixturesDir, "proto", "calculator.proto"), path.join(dir, "proto", "calculator.proto"));
  fs.writeFileSync(path.join(dir, "service.json"), JSON.stringify({
    schema: "chaitin.octobus.service.v1",
    name: "calculator",
    proto: {
      roots: ["proto"],
      files: ["calculator.proto"],
    },
  }), "utf8");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "calculator",
    bin: { calculator: "bin/calculator.js" },
  }), "utf8");
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "bin/calculator.js"), "#!/usr/bin/env node\n", "utf8");
  return dir;
}
