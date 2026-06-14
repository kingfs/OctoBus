import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineService, validateService } from "../src/index.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("validateService", () => {
  it("validates package and handler keys", () => {
    const service = defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": () => ({ result: 1 }),
      },
    });

    const result = validateService(service, { cwd: fixturesDir, env: { OCTOBUS_PACKAGE_DIR: fixturesDir } });

    expect(result.valid).toBe(true);
    expect(result.entry).toBe("calculator-handler.js");
    expect(result.unaryMethods).toContain("calculator.v1.CalculatorService/Add");
    expect(result.streamingMethods).toContain("calculator.v1.CalculatorService/Sum");
    expect(result.issues).toContainEqual({
      severity: "warning",
      message: "method calculator.v1.CalculatorService/Subtract has no handler and will return UNIMPLEMENTED",
    });
  });

  it("reports unknown handlers and accepts streaming handlers", () => {
    const service = defineService({
      handlers: {
        "calculator.v1.CalculatorService/Missing": () => ({}),
        "calculator.v1.CalculatorService/Sum": () => ({}),
      },
    });

    const result = validateService(service, { cwd: fixturesDir, env: { OCTOBUS_PACKAGE_DIR: fixturesDir } });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      severity: "error",
      message: "handler calculator.v1.CalculatorService/Missing does not match any service method in service.json proto files",
    });
  });

  it("can treat missing handlers as errors", () => {
    const result = validateService(defineService({ handlers: {} }), {
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      strictHandlers: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      severity: "error",
      message: "method calculator.v1.CalculatorService/Add has no handler and will return UNIMPLEMENTED",
    });
    expect(result.issues).toContainEqual({
      severity: "error",
      message: "method calculator.v1.CalculatorService/Sum has no handler and will return UNIMPLEMENTED",
    });
  });

  it("validates service CLI command metadata", () => {
    const packageDir = copyFixturePackageWithCli({
      "calculator.v1.CalculatorService/Add": { name: "same" },
      "calculator.v1.CalculatorService/Subtract": { name: "same" },
      "calculator.v1.CalculatorService/Sum": { name: "sum" },
      "calculator.v1.CalculatorService/Missing": { name: "missing" },
      "calculator.v1.CalculatorService/EchoContract": { examples: [{ argv: ["echo-contract", "--data-json", "{}"] }] },
    });

    const result = validateService(defineService({ handlers: {} }), {
      cwd: packageDir,
      env: { OCTOBUS_PACKAGE_DIR: packageDir },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      severity: "error",
      message: "service CLI command same maps to both calculator.v1.CalculatorService/Add and calculator.v1.CalculatorService/Subtract",
    });
    expect(result.issues).toContainEqual({
      severity: "error",
      message: "service.json sdk.cli.commands calculator.v1.CalculatorService/Sum targets streaming method calculator.v1.CalculatorService/Sum",
    });
    expect(result.issues).toContainEqual({
      severity: "error",
      message: "service.json sdk.cli.commands calculator.v1.CalculatorService/Missing does not match any unary service method",
    });
  });

  it("validates service CLI command examples", () => {
    const packageDir = copyFixturePackageWithCli({
      "calculator.v1.CalculatorService/Add": {
        examples: [
          { argv: "add --data-json {}" },
          { argv: ["add"], description: 123 },
        ],
      },
    });

    const result = validateService(defineService({ handlers: {} }), {
      cwd: packageDir,
      env: { OCTOBUS_PACKAGE_DIR: packageDir },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      severity: "error",
      message: "service.json sdk.cli.commands calculator.v1.CalculatorService/Add.examples[0].argv must be a string array",
    });
    expect(result.issues).toContainEqual({
      severity: "error",
      message: "service.json sdk.cli.commands calculator.v1.CalculatorService/Add.examples[1].description must be a string",
    });
  });
});

function copyFixturePackageWithCli(commands: Record<string, { name?: string; description?: string; examples?: unknown }>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-validation-"));
  fs.mkdirSync(path.join(dir, "proto"));
  fs.copyFileSync(path.join(fixturesDir, "proto", "calculator.proto"), path.join(dir, "proto", "calculator.proto"));
  fs.copyFileSync(path.join(fixturesDir, "calculator-handler.js"), path.join(dir, "calculator-handler.js"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "calculator-fixture",
    version: "9.9.9",
    type: "module",
    bin: {
      calculator: "calculator-handler.js",
    },
  }), "utf8");
  fs.writeFileSync(path.join(dir, "service.json"), JSON.stringify({
    schema: "chaitin.octobus.service.v1",
    name: "calculator",
    version: "0.1.0",
    proto: {
      roots: ["proto"],
      files: ["calculator.proto"],
    },
    sdk: {
      cli: {
        commands,
      },
    },
  }), "utf8");
  return dir;
}
