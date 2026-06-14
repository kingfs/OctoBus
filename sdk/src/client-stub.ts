import { findPackageRoot, loadServiceRuntime, type GrpcServiceDefinition, type LoadedServicePackage } from "./proto-loader.js";

export type ClientStubTransport = "connect" | "grpc";

export interface GenerateClientStubSourceOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fromFile?: string;
  packageDir?: string;
  descriptorPath?: string;
  manifestPath?: string;
  transport: ClientStubTransport;
  factoryName?: string;
  descriptorBacked?: boolean;
}

export interface ClientStubMethod {
  serviceName: string;
  methodName: string;
  fullName: string;
  kind: GrpcMethodKind;
}

type GrpcMethodKind = "unary" | "server_streaming" | "client_streaming" | "bidi_streaming";

export function generateClientStubSource(options: GenerateClientStubSourceOptions): string {
  validateClientStubOptions(options);
  const loaded = options.descriptorPath
    ? loadServiceRuntime({
        descriptorPath: options.descriptorPath,
        manifestPath: options.manifestPath,
        packageDir: options.packageDir,
      })
    : loadServiceRuntime({
        packageDir: options.packageDir ?? findPackageRoot({ cwd: options.cwd, env: options.env, fromFile: options.fromFile }),
        env: options.env,
      });

  return generateClientStubSourceFromLoaded({
    loaded,
    transport: options.transport,
    factoryName: options.factoryName ?? defaultClientStubFactoryName(options.transport),
    descriptorBacked: options.descriptorBacked === true,
  });
}

export function generateClientStubSourceFromLoaded(options: {
  loaded: LoadedServicePackage;
  transport: ClientStubTransport;
  factoryName: string;
  descriptorBacked?: boolean;
}): string {
  validateTransport(options.transport, "client-stub --transport");
  validateIdentifier(options.factoryName, `${transportLabel(options.transport)} stub factory name`);

  const methods = clientStubMethods(options.loaded.grpcServices, options.transport);
  const aliases = serviceAliasMap(methods.map((method) => method.serviceName));
  const sdkFactory = options.transport === "connect" ? "createConnectRpcStub" : "createGrpcStub";
  const prelude = options.descriptorBacked === true
    ? [
      `import { dirname, join } from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { ${sdkFactory} } from "@chaitin-ai/octobus-sdk";`,
      "",
      "const __dirname = dirname(fileURLToPath(import.meta.url));",
      `const descriptorPath = join(__dirname, "descriptors", "descriptor.pb");`,
      `const manifestPath = join(__dirname, "descriptors", "service.json");`,
      "",
    ]
    : [
      `import { ${sdkFactory} } from "@chaitin-ai/octobus-sdk";`,
      "",
    ];

  const lines = [
    ...prelude,
    `export function ${options.factoryName}(options) {`,
    ...(options.descriptorBacked === true
      ? [
        `  const stub = ${sdkFactory}({`,
        "    ...options,",
        "    descriptorPath,",
        "    manifestPath,",
        "  });",
      ]
      : [`  const stub = ${sdkFactory}(options);`]),
    "",
    "  return {",
    "    invoke: stub.invoke,",
    "    services: stub.services,",
    "    methods: stub.methods,",
  ];

  if (options.transport === "grpc") {
    lines.push(
      "    raw: stub.raw,",
      "    close: () => stub.close(),",
    );
  }

  for (const [serviceName, alias] of aliases) {
    const serviceMethods = methods.filter((method) => method.serviceName === serviceName);
    lines.push(`    ${JSON.stringify(alias)}: {`);
    for (const method of serviceMethods) {
      const argumentName = method.kind === "client_streaming" || method.kind === "bidi_streaming" ? "requests" : "request";
      lines.push(`      ${JSON.stringify(method.methodName)}: (${argumentName}, options) => stub.invoke(${JSON.stringify(method.fullName)}, ${argumentName}, options),`);
    }
    lines.push("    },");
  }

  lines.push(
    "  };",
    "}",
    "",
  );
  return lines.join("\n");
}

export function defaultClientStubFactoryName(transport: ClientStubTransport): string {
  return transport === "connect" ? "createConnectRpcClient" : "createGrpcClient";
}

export function clientStubMethods(services: GrpcServiceDefinition[], transport: ClientStubTransport): ClientStubMethod[] {
  const methods = discoverMethods(services);
  return transport === "connect" ? methods.filter((method) => method.kind === "unary") : methods;
}

export function clientStubServiceAliasMap(serviceNames: string[]): Map<string, string> {
  return serviceAliasMap(serviceNames);
}

export function validateClientStubFactoryName(value: string, field: string): void {
  validateIdentifier(value, field);
}

export function validateClientStubTransport(value: string, field = "client-stub --transport"): asserts value is ClientStubTransport {
  validateTransport(value, field);
}

function validateClientStubOptions(options: GenerateClientStubSourceOptions): void {
  validateTransport(options.transport, "client-stub --transport");
  if (options.factoryName !== undefined) {
    validateIdentifier(options.factoryName, "client-stub --factory");
  }
}

function discoverMethods(services: GrpcServiceDefinition[]): ClientStubMethod[] {
  const methods: ClientStubMethod[] = [];
  for (const service of services) {
    for (const [methodName, definition] of Object.entries(service.definition)) {
      methods.push({
        serviceName: service.descriptor.typeName,
        methodName,
        fullName: `${service.descriptor.typeName}/${methodName}`,
        kind: grpcMethodKind(definition.requestStream === true, definition.responseStream === true),
      });
    }
  }
  return methods;
}

function grpcMethodKind(requestStream: boolean, responseStream: boolean): GrpcMethodKind {
  if (requestStream && responseStream) {
    return "bidi_streaming";
  }
  if (requestStream) {
    return "client_streaming";
  }
  if (responseStream) {
    return "server_streaming";
  }
  return "unary";
}

function serviceAliasMap(serviceNames: string[]): Map<string, string> {
  const unique = [...new Set(serviceNames)];
  const shortCounts = new Map<string, number>();
  for (const serviceName of unique) {
    const shortName = serviceName.split(".").at(-1) ?? serviceName;
    shortCounts.set(shortName, (shortCounts.get(shortName) ?? 0) + 1);
  }
  const aliases = new Map<string, string>();
  for (const serviceName of unique) {
    const shortName = serviceName.split(".").at(-1) ?? serviceName;
    aliases.set(serviceName, shortCounts.get(shortName) === 1 ? shortName : serviceName);
  }
  return aliases;
}

function validateTransport(value: string, field: string): asserts value is ClientStubTransport {
  if (value !== "connect" && value !== "grpc") {
    throw new Error(`${field} must be connect or grpc`);
  }
}

function validateIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(value)) {
    throw new Error(`${field} ${JSON.stringify(value)} is not a valid JavaScript identifier`);
  }
}

function transportLabel(transport: ClientStubTransport): string {
  return transport === "connect" ? "Connect RPC" : "gRPC";
}
