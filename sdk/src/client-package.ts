import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import {
  findPackageRoot,
  loadServicePackage,
  type LoadedServicePackage,
} from "./proto-loader.js";
import {
  clientStubMethods,
  clientStubServiceAliasMap,
  defaultClientStubFactoryName,
  generateClientStubSourceFromLoaded,
  validateClientStubFactoryName,
  type ClientStubMethod,
} from "./client-stub.js";

export type ClientPackageTransport = "connect" | "grpc";

export interface GenerateClientPackageOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fromFile?: string;
  packageDir?: string;
  transport: ClientPackageTransport;
  packageName: string;
  factoryName?: string;
  bundleDeps?: boolean;
}

export interface ClientPackageFile {
  path: string;
  content: string | Uint8Array;
}

export interface WriteClientPackageOptions extends GenerateClientPackageOptions {
  outDir: string;
  force?: boolean;
  publish?: boolean;
  npmEnv?: NodeJS.ProcessEnv;
}

export interface WriteClientPackageResult {
  outDir: string;
  files: ClientPackageFile[];
  bundled: boolean;
  published: boolean;
}

const SDK_PACKAGE_NAME = "@chaitin-ai/octobus-sdk";
const GRPC_PACKAGE_NAME = "@grpc/grpc-js";

export function generateClientPackageFiles(options: GenerateClientPackageOptions): ClientPackageFile[] {
  validateClientPackageOptions(options);
  const packageDir = options.packageDir ?? findPackageRoot({ cwd: options.cwd, env: options.env, fromFile: options.fromFile });
  const loaded = loadServicePackage(packageDir, options.env ?? process.env);
  const manifestPath = path.join(packageDir, "service.json");
  const manifestJson = fs.readFileSync(manifestPath, "utf8");
  const factoryName = options.factoryName ?? defaultClientStubFactoryName(options.transport);

  return [
    {
      path: "package.json",
      content: `${JSON.stringify(clientPackageJson(options.transport, options.packageName, options.bundleDeps === true), null, 2)}\n`,
    },
    {
      path: "README.md",
      content: generateReadme(options.transport, options.packageName, loaded.manifest.name, factoryName),
    },
    {
      path: "index.js",
      content: generateClientStubSourceFromLoaded({
        loaded,
        transport: options.transport,
        factoryName,
        descriptorBacked: true,
      }),
    },
    {
      path: "index.d.ts",
      content: generateClientPackageTypes(loaded, options.transport, factoryName),
    },
    {
      path: path.join("descriptors", "descriptor.pb"),
      content: toBinary(FileDescriptorSetSchema, loaded.descriptorSet),
    },
    {
      path: path.join("descriptors", "service.json"),
      content: manifestJson.endsWith("\n") ? manifestJson : `${manifestJson}\n`,
    },
  ];
}

export function writeClientPackage(options: WriteClientPackageOptions): WriteClientPackageResult {
  const files = generateClientPackageFiles(options);
  const outDir = path.resolve(options.outDir);

  if (fs.existsSync(outDir) && !options.force && fs.readdirSync(outDir).length > 0) {
    throw new Error(`output directory ${outDir} is not empty; pass --force to overwrite generated files`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const destination = path.resolve(outDir, file.path);
    assertInside(outDir, destination, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.content);
  }

  if (options.bundleDeps === true) {
    installBundledDependencies(outDir, options.npmEnv);
  }
  if (options.publish === true) {
    publishClientPackage(outDir, options.npmEnv);
  }

  return { outDir, files, bundled: options.bundleDeps === true, published: options.publish === true };
}

export function defaultClientPackageFactoryName(transport: ClientPackageTransport): string {
  return defaultClientStubFactoryName(transport);
}

function validateClientPackageOptions(options: GenerateClientPackageOptions): void {
  if (options.transport !== "connect" && options.transport !== "grpc") {
    throw new Error("client-package --transport must be connect or grpc");
  }
  validatePackageName(options.packageName);
  if (options.factoryName !== undefined) {
    validateClientStubFactoryName(options.factoryName, "client-package --factory");
  }
}

function clientPackageJson(transport: ClientPackageTransport, packageName: string, bundleDeps: boolean): Record<string, unknown> {
  const dependencies: Record<string, string> = {
    [SDK_PACKAGE_NAME]: sdkDependencyVersion(),
  };
  if (transport === "grpc") {
    dependencies[GRPC_PACKAGE_NAME] = "^1.13.4";
  }
  const base = {
    name: packageName,
    version: "0.1.0",
    type: "module",
    main: "index.js",
    types: "index.d.ts",
    dependencies,
  };
  if (bundleDeps) {
    return {
      ...base,
      bundledDependencies: bundledDependencies(transport),
    };
  }
  return base;
}

function generateReadme(
  transport: ClientPackageTransport,
  packageName: string,
  servicePackageName: string,
  factoryName: string,
): string {
  const options = transport === "connect"
    ? `  baseUrl: "http://127.0.0.1:8080",\n  capsetId: "dev",\n  instanceId: "instance-id",`
    : `  address: "127.0.0.1:50051",`;
  return [
    `# ${packageName}`,
    "",
    `Generated OctoBus ${transport === "connect" ? "Connect RPC" : "gRPC"} client for \`${servicePackageName}\`.`,
    "",
    "```js",
    `import { ${factoryName} } from ${JSON.stringify(packageName)};`,
    "",
    `const client = ${factoryName}({`,
    options,
    "});",
    "```",
    "",
  ].join("\n");
}

function generateClientPackageTypes(
  loaded: LoadedServicePackage,
  transport: ClientPackageTransport,
  factoryName: string,
): string {
  const methods = clientStubMethods(loaded.grpcServices, transport);
  const aliases = clientStubServiceAliasMap(methods.map((method) => method.serviceName));
  const lines = transport === "connect"
    ? [
      `import type { ConnectRpcInvokeOptions, ConnectRpcStub, ConnectRpcStubOptions } from "@chaitin-ai/octobus-sdk";`,
      "",
    ]
    : [
      `import type { GrpcInvokeOptions, GrpcReadableResult, GrpcStub, GrpcStubOptions } from "@chaitin-ai/octobus-sdk";`,
      "",
    ];

  for (const [serviceName, alias] of aliases) {
    lines.push(`export interface ${serviceClientTypeName(alias)} {`);
    const serviceMethods = methods.filter((method) => method.serviceName === serviceName);
    for (const method of serviceMethods) {
      lines.push(...methodSignatureLines(method, transport));
    }
    lines.push("}", "");
  }

  const baseType = transport === "connect" ? "ConnectRpcStub" : "GrpcStub";
  const optionsType = transport === "connect" ? "ConnectRpcStubOptions" : "GrpcStubOptions";
  lines.push(`export function ${factoryName}(options: ${optionsType}): ${baseType} & {`);
  for (const [, alias] of aliases) {
    lines.push(`  ${quotePropertyIfNeeded(alias)}: ${serviceClientTypeName(alias)};`);
  }
  lines.push("};", "");
  return lines.join("\n");
}

function methodSignatureLines(method: ClientStubMethod, transport: ClientPackageTransport): string[] {
  const methodName = quotePropertyIfNeeded(method.methodName);
  if (transport === "connect" || method.kind === "unary") {
    const optionsType = transport === "connect" ? "ConnectRpcInvokeOptions" : "GrpcInvokeOptions";
    return [`  ${methodName}(request?: unknown, options?: ${optionsType}): Promise<unknown>;`];
  }
  if (method.kind === "server_streaming") {
    return [`  ${methodName}(request?: unknown, options?: GrpcInvokeOptions): GrpcReadableResult;`];
  }
  if (method.kind === "client_streaming") {
    return [
      `  ${methodName}(`,
      "    requests: Iterable<unknown> | AsyncIterable<unknown>,",
      "    options?: GrpcInvokeOptions,",
      "  ): Promise<unknown>;",
    ];
  }
  return [
    `  ${methodName}(`,
    "    requests: Iterable<unknown> | AsyncIterable<unknown>,",
    "    options?: GrpcInvokeOptions,",
    "  ): GrpcReadableResult;",
  ];
}

function validatePackageName(value: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("client-package --name is required");
  }
  if (value.length > 214) {
    throw new Error(`client-package --name ${JSON.stringify(value)} is too long`);
  }
  const namePattern = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
  if (!namePattern.test(value)) {
    throw new Error(`client-package --name ${JSON.stringify(value)} is not a valid npm package name`);
  }
}

function quotePropertyIfNeeded(value: string): string {
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(value) ? value : JSON.stringify(value);
}

function serviceClientTypeName(alias: string): string {
  const parts = alias.split(/[^0-9A-Za-z_$]+/).filter(Boolean);
  const name = parts.length > 0
    ? parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("")
    : "Service";
  const safe = name.replace(/^[^A-Za-z_$]+/, "");
  return `${safe || "Service"}Client`;
}

function assertInside(root: string, target: string, relativePath: string): void {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`generated file path ${JSON.stringify(relativePath)} must stay inside the output directory`);
  }
}

function sdkDependencyVersion(): string {
  return "*";
}

function bundledDependencies(transport: ClientPackageTransport): string[] {
  return transport === "connect" ? [SDK_PACKAGE_NAME] : [SDK_PACKAGE_NAME, GRPC_PACKAGE_NAME];
}

function installBundledDependencies(outDir: string, env: NodeJS.ProcessEnv | undefined): void {
  try {
    execFileSync("npm", ["install", "--omit=dev"], {
      cwd: outDir,
      env,
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(`npm install --omit=dev failed in ${outDir}: ${commandErrorMessage(error)}`);
  }
}

function publishClientPackage(outDir: string, env: NodeJS.ProcessEnv | undefined): void {
  try {
    execFileSync("npm", ["publish"], {
      cwd: outDir,
      env,
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(`npm publish failed in ${outDir}: ${commandErrorMessage(error)}`);
  }
}

function commandErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const maybe = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = bufferText(maybe.stderr);
    if (stderr) {
      return stderr;
    }
    const stdout = bufferText(maybe.stdout);
    if (stdout) {
      return stdout;
    }
    if (typeof maybe.message === "string") {
      return maybe.message;
    }
  }
  return String(error);
}

function bufferText(value: unknown): string | undefined {
  if (Buffer.isBuffer(value)) {
    const text = value.toString("utf8").trim();
    return text || undefined;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text || undefined;
  }
  return undefined;
}
