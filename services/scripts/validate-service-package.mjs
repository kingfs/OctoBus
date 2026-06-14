#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_PACKAGE_NAME = "@chaitin-ai/octobus-tentacles";
export const EXPECTED_ROOT_BIN_NAME = "octobus-tentacles";
export const SERVICE_DIR_RE = /^[a-z0-9][a-z0-9-]*__[a-z0-9][a-z0-9-]*(?:_[a-z0-9][a-z0-9-]*)?$/;
export const SERVICE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath}: failed to read JSON: ${error.message}`);
  }
}

function parseArgs(argv) {
  const opts = {
    root: process.cwd(),
    serviceDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      opts.root = argv[++i];
      continue;
    }
    if (arg.startsWith("--root=")) {
      opts.root = arg.slice("--root=".length);
      continue;
    }
    if (arg === "--service-dir") {
      opts.serviceDir = argv[++i];
      continue;
    }
    if (arg.startsWith("--service-dir=")) {
      opts.serviceDir = arg.slice("--service-dir=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (opts.root == null || opts.root === "") {
    throw new Error("--root must not be empty");
  }
  if (opts.serviceDir === "") {
    throw new Error("--service-dir must not be empty");
  }

  return {
    root: path.resolve(opts.root),
    serviceDir: opts.serviceDir,
  };
}

function isPackagePrivateServiceDir(root, dirent) {
  if (!dirent.isDirectory()) {
    return false;
  }
  if (dirent.name === "bin" || dirent.name === "scripts" || dirent.name === "tests" || dirent.name === "node_modules") {
    return false;
  }
  if (dirent.name.startsWith(".")) {
    return false;
  }
  return fs.existsSync(path.join(root, dirent.name, "service.json"));
}

function packageBinEntries(bin) {
  if (typeof bin === "string") {
    return new Map([["", bin]]);
  }
  if (bin != null && typeof bin === "object" && !Array.isArray(bin)) {
    return new Map(Object.entries(bin));
  }
  return new Map();
}

function validateRelativePackagePath(errors, value, label) {
  if (typeof value !== "string" || value === "") {
    errors.push(`${label} must be a non-empty string`);
    return null;
  }
  if (path.isAbsolute(value)) {
    errors.push(`${label} must be a relative package path`);
  }
  const normalized = path.posix.normalize(value.replaceAll(path.win32.sep, path.posix.sep));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    errors.push(`${label} must stay inside the package root`);
  }
  return normalized;
}

function validateExistingFile(errors, root, relativePath, label) {
  const normalized = validateRelativePackagePath(errors, relativePath, label);
  if (normalized == null) {
    return null;
  }
  const fullPath = path.join(root, filepathFromPackagePath(normalized));
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    errors.push(`${label} "${normalized}" must exist`);
    return null;
  }
  if (!stat.isFile()) {
    errors.push(`${label} "${normalized}" must be a file`);
    return null;
  }
  return normalized;
}

function validateExistingDirectory(errors, root, relativePath, label) {
  const normalized = validateRelativePackagePath(errors, relativePath, label);
  if (normalized == null) {
    return null;
  }
  const fullPath = path.join(root, filepathFromPackagePath(normalized));
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    errors.push(`${label} "${normalized}" must exist`);
    return null;
  }
  if (!stat.isDirectory()) {
    errors.push(`${label} "${normalized}" must be a directory`);
    return null;
  }
  return normalized;
}

function filepathFromPackagePath(packagePath) {
  return packagePath.split("/").join(path.sep);
}

function validateDependency(errors, pkg, name) {
  const dependencies = pkg.dependencies != null && typeof pkg.dependencies === "object" && !Array.isArray(pkg.dependencies)
    ? pkg.dependencies
    : {};
  if (typeof dependencies[name] !== "string" || dependencies[name] === "") {
    errors.push(`package.json dependencies must contain direct dependency "${name}"`);
  }

  const bundled = Array.isArray(pkg.bundledDependencies) ? pkg.bundledDependencies : [];
  if (!bundled.includes(name)) {
    errors.push(`package.json bundledDependencies must include "${name}"`);
  }
}

function validateRootDispatcher(errors, root, pkg, binEntries, serviceDirs) {
  if (serviceDirs.length === 0) {
    return null;
  }

  validateDependency(errors, pkg, "@chaitin-ai/octobus-sdk");
  validateDependency(errors, pkg, "commander");

  if (!binEntries.has(EXPECTED_ROOT_BIN_NAME)) {
    errors.push(`package.json bin must contain default dispatcher "${EXPECTED_ROOT_BIN_NAME}"`);
    return null;
  }

  const dispatcherTarget = validateExistingFile(errors, root, binEntries.get(EXPECTED_ROOT_BIN_NAME), `package.json bin ${EXPECTED_ROOT_BIN_NAME} target`);
  if (dispatcherTarget == null) {
    return null;
  }

  const files = Array.isArray(pkg.files) ? pkg.files : [];
  if (!files.includes(dispatcherTarget)) {
    errors.push(`package.json files must include default dispatcher "${dispatcherTarget}"`);
  }

  const dispatcher = fs.readFileSync(path.join(root, filepathFromPackagePath(dispatcherTarget)), "utf8");
  for (const snippet of [
    "import { Command } from \"commander\";",
    ".allowUnknownOption(true)",
    ".allowExcessArguments(true)",
    ".passThroughOptions()",
    "argv: program.args.slice(1)",
    "entryFile: fileURLToPath(new URL(selected.entryFile, import.meta.url))",
  ]) {
    if (!dispatcher.includes(snippet)) {
      errors.push(`${dispatcherTarget} must include dispatcher behavior: ${snippet}`);
    }
  }
  return dispatcher;
}

function validateRootWrapper(errors, root, serviceDir, serviceName, rootBinTarget) {
  const entryFile = path.posix.join("..", serviceDir, "bin", path.posix.basename(rootBinTarget));
  const wrapper = fs.readFileSync(path.join(root, filepathFromPackagePath(rootBinTarget)), "utf8");
  if (!wrapper.includes("import { fileURLToPath } from \"node:url\";")) {
    errors.push(`package.json bin ${serviceName} target must import fileURLToPath`);
  }
  if (!wrapper.includes("runServiceMain(service, {")) {
    errors.push(`package.json bin ${serviceName} target must pass runServiceMain options`);
  }
  if (!wrapper.includes(`entryFile: fileURLToPath(new URL("${entryFile}", import.meta.url))`)) {
    errors.push(`package.json bin ${serviceName} target must set entryFile to "${entryFile}"`);
  }
}

function validateDispatcherService(errors, dispatcher, serviceDir, serviceName, rootBinTarget) {
  if (dispatcher == null) {
    return;
  }
  const entryFile = path.posix.join("..", serviceDir, "bin", path.posix.basename(rootBinTarget));
  const serviceModule = path.posix.join("..", serviceDir, "src", "service.js");
  for (const snippet of [
    `"${serviceName}": {`,
    `entryFile: "${entryFile}",`,
    `serviceModule: "${serviceModule}",`,
  ]) {
    if (!dispatcher.includes(snippet)) {
      errors.push(`default dispatcher must include ${serviceName} mapping snippet: ${snippet}`);
    }
  }
}

function validateStringArray(errors, value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must be a non-empty array`);
    return [];
  }
  const strings = [];
  for (const item of value) {
    if (typeof item !== "string" || item === "") {
      errors.push(`${label} entries must be non-empty strings`);
      continue;
    }
    strings.push(item);
  }
  return strings;
}

export function validateRepository(root, options = {}) {
  const errors = [];
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) {
    return { errors: [`${packagePath}: missing root package.json`] };
  }

  const pkg = readJSON(packagePath);
  if (pkg.name !== EXPECTED_PACKAGE_NAME) {
    errors.push(`package.json name must be ${EXPECTED_PACKAGE_NAME}`);
  }

  const requestedServiceDir = options.serviceDir ?? null;
  const serviceDirs = requestedServiceDir == null
    ? fs.readdirSync(root, { withFileTypes: true })
      .filter((dirent) => isPackagePrivateServiceDir(root, dirent))
      .map((dirent) => dirent.name)
      .sort()
    : [requestedServiceDir];

  const binEntries = packageBinEntries(pkg.bin);
  if (binEntries.size === 0 && serviceDirs.length > 0) {
    errors.push("package.json bin must be an object with service command entries");
  }
  const dispatcher = validateRootDispatcher(errors, root, pkg, binEntries, serviceDirs);
  for (const [name, target] of binEntries) {
    if (name !== "" && !SERVICE_NAME_RE.test(name)) {
      errors.push(`package.json bin key "${name}" must match ${SERVICE_NAME_RE}`);
    }
    validateExistingFile(errors, root, target, `package.json bin ${name || "string"} target`);
  }

  for (const serviceDir of serviceDirs) {
    validateRelativePackagePath(errors, serviceDir, `service dir "${serviceDir}"`);
    if (!SERVICE_DIR_RE.test(serviceDir)) {
      errors.push(`service root "${serviceDir}" must match ${SERVICE_DIR_RE}`);
    }

    const serviceRoot = path.join(root, serviceDir);
    const serviceJSONPath = path.join(serviceRoot, "service.json");
    if (!fs.existsSync(serviceJSONPath)) {
      errors.push(`${serviceDir}/service.json is required`);
      continue;
    }

    const manifest = readJSON(serviceJSONPath);
    if (manifest.schema !== "chaitin.octobus.service.v1") {
      errors.push(`${serviceDir}/service.json schema must be chaitin.octobus.service.v1`);
    }
    if (!SERVICE_NAME_RE.test(manifest.name ?? "")) {
      errors.push(`${serviceDir}/service.json name "${manifest.name ?? ""}" must match ${SERVICE_NAME_RE}`);
    }
    if (!binEntries.has(manifest.name)) {
      errors.push(`package.json bin must contain an entry for service "${manifest.name}"`);
    } else {
      const rootBinTarget = validateExistingFile(errors, root, binEntries.get(manifest.name), `package.json bin ${manifest.name} target`);
      if (rootBinTarget != null) {
        const serviceBinTarget = path.posix.join("bin", path.posix.basename(rootBinTarget));
        validateExistingFile(errors, serviceRoot, serviceBinTarget, `${serviceDir} service entry`);
        validateRootWrapper(errors, root, serviceDir, manifest.name, rootBinTarget);
        validateDispatcherService(errors, dispatcher, serviceDir, manifest.name, rootBinTarget);
      }
    }

    validateExistingFile(errors, serviceRoot, "README.md", `${serviceDir}/README.md`);
    validateExistingFile(errors, serviceRoot, manifest.configSchema, `${serviceDir}/configSchema`);
    validateExistingFile(errors, serviceRoot, manifest.secretSchema, `${serviceDir}/secretSchema`);

    const protoRoots = validateStringArray(errors, manifest.proto?.roots, `${serviceDir}/service.json proto.roots`);
    for (const protoRoot of protoRoots) {
      validateExistingDirectory(errors, serviceRoot, protoRoot, `${serviceDir}/service.json proto root`);
    }
    const protoFiles = validateStringArray(errors, manifest.proto?.files, `${serviceDir}/service.json proto.files`);
    for (const protoFile of protoFiles) {
      validateExistingFile(errors, serviceRoot, protoFile, `${serviceDir}/service.json proto file`);
      if (!protoFile.endsWith(".proto")) {
        errors.push(`${serviceDir}/service.json proto file "${protoFile}" must end with .proto`);
      }
    }
  }

  return { errors };
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const { errors } = validateRepository(opts.root, { serviceDir: opts.serviceDir });
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`error: ${error}`);
    }
    return 1;
  }
  console.log("service package naming checks passed");
  return 0;
}

const entrypoint = fileURLToPath(import.meta.url);
if (process.argv[1] != null && path.resolve(process.argv[1]) === entrypoint) {
  process.exitCode = main();
}
