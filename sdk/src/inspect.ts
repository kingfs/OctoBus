import fs from "node:fs";
import { findPackageRoot, readServiceManifest, validatePackageFile } from "./proto-loader.js";
import YAML from "yaml";

export interface InspectOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fromFile?: string;
  stdout?: Pick<NodeJS.WriteStream, "write">;
}

export type ServiceSchemaKind = "config" | "secret";

export function inspectManifest(options: InspectOptions = {}): Record<string, unknown> {
  const packageDir = findPackageRoot({ cwd: options.cwd, env: options.env, fromFile: options.fromFile });
  const manifest = readServiceManifest(packageDir);
  return {
    schema: manifest.schema,
    name: manifest.name,
    version: manifest.version,
    proto: manifest.proto,
  };
}

export function inspectJson(options: InspectOptions = {}): Record<string, unknown> {
  const output = inspectManifest(options);
  options.stdout?.write(`${JSON.stringify(output, null, 2)}\n`);
  return output;
}

export function inspectYaml(options: InspectOptions = {}): Record<string, unknown> {
  const output = inspectManifest(options);
  options.stdout?.write(YAML.stringify(output));
  return output;
}

export function inspectSchemaJson(kind: ServiceSchemaKind, options: InspectOptions = {}): unknown {
  const output = readServiceSchema(kind, options);
  options.stdout?.write(`${JSON.stringify(output, null, 2)}\n`);
  return output;
}

export function inspectSchemaYaml(kind: ServiceSchemaKind, options: InspectOptions = {}): unknown {
  const output = readServiceSchema(kind, options);
  options.stdout?.write(YAML.stringify(output));
  return output;
}

export function readServiceSchema(kind: ServiceSchemaKind, options: InspectOptions = {}): unknown {
  const packageDir = findPackageRoot({ cwd: options.cwd, env: options.env, fromFile: options.fromFile });
  const manifest = readServiceManifest(packageDir);
  const schemaPath = kind === "config" ? manifest.configSchema : manifest.secretSchema;
  if (!schemaPath) {
    throw new Error(`service.json does not define ${kind}Schema`);
  }
  const fullPath = validatePackageFile(packageDir, schemaPath, `${kind}Schema`);
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as unknown;
}
