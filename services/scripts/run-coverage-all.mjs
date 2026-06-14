#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function discoverServiceDirs(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => fs.existsSync(path.join(root, dirent.name, "service.json")))
    .map((dirent) => dirent.name)
    .sort();
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (argv.length > 0) {
    throw new Error(`unknown argument: ${argv[0]}`);
  }

  const serviceDirs = discoverServiceDirs(root);
  for (const serviceDir of serviceDirs) {
    console.log(`coverage ${serviceDir}`);
    const result = spawnSync(process.execPath, [
      "scripts/run-tests.mjs",
      "--service-dir",
      serviceDir,
      "--coverage",
    ], {
      cwd: root,
      stdio: "inherit",
    });
    if ((result.status ?? 1) !== 0) {
      return result.status ?? 1;
    }
  }
  console.log(`coverage checks passed for ${serviceDirs.length} services`);
  return 0;
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exitCode = main();
}
