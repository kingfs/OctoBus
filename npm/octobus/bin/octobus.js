#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const platformPackages = {
  "linux-x64": { name: "@chaitin-ai/octobus-linux-x64", binary: "octobus" },
  "linux-arm64": { name: "@chaitin-ai/octobus-linux-arm64", binary: "octobus" },
  "darwin-x64": { name: "@chaitin-ai/octobus-darwin-x64", binary: "octobus" },
  "darwin-arm64": { name: "@chaitin-ai/octobus-darwin-arm64", binary: "octobus" },
  "win32-x64": { name: "@chaitin-ai/octobus-win32-x64", binary: "octobus.exe" },
  "win32-arm64": { name: "@chaitin-ai/octobus-win32-arm64", binary: "octobus.exe" }
};

const platformKey = `${process.platform}-${process.arch}`;
const platformPackage = platformPackages[platformKey];

if (!platformPackage) {
  console.error(`OctoBus does not provide an npm binary package for ${platformKey}.`);
  process.exit(1);
}

let packageJSON;
try {
  packageJSON = require.resolve(`${platformPackage.name}/package.json`);
} catch (error) {
  console.error(`OctoBus platform package ${platformPackage.name} is not installed.`);
  console.error("Reinstall @chaitin-ai/octobus with optional dependencies enabled.");
  process.exit(1);
}

const binary = path.join(path.dirname(packageJSON), "bin", platformPackage.binary);
const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
