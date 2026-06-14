import type { ServiceDefinition } from "./service.js";
import { findPackageRoot, inferPackageBin, loadServicePackage, validatePackageFile, type GrpcServiceDefinition } from "./proto-loader.js";

export type ValidationSeverity = "error" | "warning";

export interface ServiceValidationIssue {
  severity: ValidationSeverity;
  message: string;
}

export interface ServiceValidationOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fromFile?: string;
  strictHandlers?: boolean;
}

export interface ServiceValidationResult {
  valid: boolean;
  packageDir?: string;
  entry?: string;
  unaryMethods: string[];
  streamingMethods: string[];
  issues: ServiceValidationIssue[];
}

export function validateService(
  serviceOrOptions?: ServiceDefinition | ServiceValidationOptions,
  maybeOptions: ServiceValidationOptions = {},
): ServiceValidationResult {
  const hasService = isServiceDefinition(serviceOrOptions);
  const service = hasService ? serviceOrOptions : undefined;
  const options = hasService ? maybeOptions : serviceOrOptions ?? {};
  const issues: ServiceValidationIssue[] = [];
  let packageDir: string | undefined;
  let entry: string | undefined;
  let unaryMethods: string[] = [];
  let streamingMethods: string[] = [];

  try {
    packageDir = findPackageRoot({ cwd: options.cwd, env: options.env, fromFile: options.fromFile });
    entry = inferPackageBin(packageDir);
    validatePackageFile(packageDir, entry, "package.json bin");
    const loaded = loadServicePackage(packageDir, options.env ?? process.env);
    const methods = discoverGrpcMethods(loaded.grpcServices);
    unaryMethods = methods.filter((method) => method.unary).map((method) => method.fullName).sort();
    streamingMethods = methods.filter((method) => !method.unary).map((method) => method.fullName).sort();
    validateCliCommands(loaded.manifest.sdk?.cli?.commands, unaryMethods, streamingMethods, issues);
  } catch (error) {
    issues.push({ severity: "error", message: errorMessage(error) });
    return { valid: false, packageDir, entry, unaryMethods, streamingMethods, issues };
  }

  if (service) {
    validateHandlers(service, unaryMethods, streamingMethods, options.strictHandlers === true, issues);
  }

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    packageDir,
    entry,
    unaryMethods,
    streamingMethods,
    issues,
  };
}

function validateCliCommands(
  commands: Record<string, { name?: string; description?: string; examples?: unknown }> | undefined,
  unaryMethods: string[],
  streamingMethods: string[],
  issues: ServiceValidationIssue[],
): void {
  const metadata = commands ?? {};
  const unary = new Set(unaryMethods);
  const streaming = new Set(streamingMethods);
  for (const [method, config] of Object.entries(metadata)) {
    const normalized = normalizeMethod(method);
    if (streaming.has(normalized)) {
      issues.push({ severity: "error", message: `service.json sdk.cli.commands ${method} targets streaming method ${normalized}` });
      continue;
    }
    if (!unary.has(normalized)) {
      issues.push({ severity: "error", message: `service.json sdk.cli.commands ${method} does not match any unary service method` });
    }
    if (config.name !== undefined && (typeof config.name !== "string" || config.name.trim() === "")) {
      issues.push({ severity: "error", message: `service.json sdk.cli.commands ${method}.name must be a non-empty string` });
    }
    if (config.description !== undefined && typeof config.description !== "string") {
      issues.push({ severity: "error", message: `service.json sdk.cli.commands ${method}.description must be a string` });
    }
    validateCliCommandExamples(method, config.examples, issues);
  }

  const commandNames = new Map<string, string>();
  for (const method of unaryMethods) {
    const config = metadata[method] ?? metadata[`/${method}`];
    const command = config?.name?.trim() || kebabCase(method.slice(method.lastIndexOf("/") + 1));
    const existing = commandNames.get(command);
    if (existing) {
      issues.push({ severity: "error", message: `service CLI command ${command} maps to both ${existing} and ${method}` });
      continue;
    }
    commandNames.set(command, method);
  }
}

function validateCliCommandExamples(method: string, examples: unknown, issues: ServiceValidationIssue[]): void {
  if (examples === undefined) {
    return;
  }
  if (!Array.isArray(examples)) {
    issues.push({ severity: "error", message: `service.json sdk.cli.commands ${method}.examples must be an array` });
    return;
  }
  for (let i = 0; i < examples.length; i += 1) {
    const example = examples[i];
    if (!example || typeof example !== "object" || Array.isArray(example)) {
      issues.push({ severity: "error", message: `service.json sdk.cli.commands ${method}.examples[${i}] must be an object` });
      continue;
    }
    const record = example as { argv?: unknown; description?: unknown };
    if (!Array.isArray(record.argv) || !record.argv.every((arg) => typeof arg === "string")) {
      issues.push({ severity: "error", message: `service.json sdk.cli.commands ${method}.examples[${i}].argv must be a string array` });
    }
    if (record.description !== undefined && typeof record.description !== "string") {
      issues.push({ severity: "error", message: `service.json sdk.cli.commands ${method}.examples[${i}].description must be a string` });
    }
  }
}

export function assertValidService(service: ServiceDefinition, options: ServiceValidationOptions = {}): void {
  const result = validateService(service, options);
  const errors = result.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(formatValidationIssues(errors));
  }
}

export function formatValidationIssues(issues: ServiceValidationIssue[]): string {
  return issues.map((issue) => `${issue.severity}: ${issue.message}`).join("\n");
}

interface GrpcMethod {
  fullName: string;
  unary: boolean;
  streaming: boolean;
}

function validateHandlers(
  service: ServiceDefinition,
  unaryMethods: string[],
  streamingMethods: string[],
  strictHandlers: boolean,
  issues: ServiceValidationIssue[],
): void {
  const unary = new Set(unaryMethods);
  const streaming = new Set(streamingMethods);
  const seen = new Set<string>();
  const implemented = new Set<string>();

  for (const key of Object.keys(service.handlers)) {
    const normalized = normalizeMethod(key);
    if (seen.has(normalized)) {
      issues.push({ severity: "warning", message: `handler ${key} duplicates another handler for ${normalized}` });
    }
    seen.add(normalized);
    implemented.add(normalized);

    if (!unary.has(normalized) && !streaming.has(normalized)) {
      issues.push({ severity: "error", message: `handler ${key} does not match any service method in service.json proto files` });
    }
  }

  for (const method of [...unaryMethods, ...streamingMethods].sort()) {
    if (!implemented.has(method)) {
      issues.push({
        severity: strictHandlers ? "error" : "warning",
        message: `method ${method} has no handler and will return UNIMPLEMENTED`,
      });
    }
  }
}

function discoverGrpcMethods(grpcServices: GrpcServiceDefinition[]): GrpcMethod[] {
  const methods: GrpcMethod[] = [];
  for (const service of grpcServices) {
    for (const [methodName, methodDefinition] of Object.entries(service.definition)) {
      methods.push({
        fullName: `${service.descriptor.typeName}/${methodName}`,
        unary: !methodDefinition.requestStream && !methodDefinition.responseStream,
        streaming: methodDefinition.requestStream || methodDefinition.responseStream,
      });
    }
  }
  return methods;
}

function normalizeMethod(method: string): string {
  return method.replace(/^\//, "");
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s.]+/g, "-")
    .toLowerCase();
}

function isServiceDefinition(value: unknown): value is ServiceDefinition {
  return typeof value === "object" && value !== null && "handlers" in value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
