#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function discoverServices(root) {
  const pkg = readJSON(path.join(root, "package.json"));
  const bin = pkg.bin && typeof pkg.bin === "object" && !Array.isArray(pkg.bin) ? pkg.bin : {};
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => fs.existsSync(path.join(root, dirent.name, "service.json")))
    .map((dirent) => {
      const manifest = readJSON(path.join(root, dirent.name, "service.json"));
      return {
        dir: dirent.name,
        id: manifest.name,
        nodeEntry: bin[manifest.name],
      };
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

function parseArgs(argv) {
  const opts = {
    octobus: path.resolve(process.cwd(), "..", "bin", "octobus"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--octobus") {
      opts.octobus = argv[++i];
      continue;
    }
    if (arg.startsWith("--octobus=")) {
      opts.octobus = arg.slice("--octobus=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!opts.octobus) {
    throw new Error("--octobus must not be empty");
  }
  return opts;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if ((result.status ?? 1) !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : "";
    const stdout = result.stdout ? `\n${result.stdout}` : "";
    throw new Error(`${cmd} ${args.join(" ")} failed${stdout}${stderr}`);
  }
  return result.stdout;
}

function waitForDaemon(octobus, addr, logPath) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = spawnSync(octobus, ["--addr", addr, "service", "list"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if ((result.status ?? 1) === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  throw new Error(`daemon did not become ready\n${log}`);
}

function randomAddr() {
  return `127.0.0.1:${35000 + Math.floor(Math.random() * 20000)}`;
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const opts = parseArgs(argv);
  const serviceRoot = path.resolve(root);
  const services = discoverServices(serviceRoot);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-import-check-"));
  const addr = randomAddr();
  const dataDir = path.join(tmp, "data");
  const logPath = path.join(tmp, "daemon.log");
  const daemonLog = fs.openSync(logPath, "w");
  const daemon = spawn(opts.octobus, ["--addr", addr, "serve", "--data-dir", dataDir], {
    cwd: serviceRoot,
    stdio: ["ignore", daemonLog, daemonLog],
  });

  try {
    waitForDaemon(opts.octobus, addr, logPath);
    for (const service of services) {
      console.log(`import ${service.dir}`);
      const source = `${serviceRoot}//${service.dir}`;
      const output = run(opts.octobus, ["--addr", addr, "service", "import", "--id", service.id, source], { cwd: serviceRoot });
      const parsed = JSON.parse(output);
      const imported = parsed.service ?? {};
      if (imported.ID !== service.id) {
        throw new Error(`${service.dir}: imported ID ${imported.ID} did not match ${service.id}`);
      }
      if (imported.ServiceRoot !== service.dir) {
        throw new Error(`${service.dir}: imported ServiceRoot ${imported.ServiceRoot} did not match ${service.dir}`);
      }
      if (imported.NodeEntry !== service.nodeEntry) {
        throw new Error(`${service.dir}: imported NodeEntry ${imported.NodeEntry} did not match ${service.nodeEntry}`);
      }
    }
    console.log(`import checks passed for ${services.length} services`);
    return 0;
  } finally {
    daemon.kill();
    try {
      fs.closeSync(daemonLog);
    } catch {
      // Already closed by process cleanup.
    }
    spawnSync("rm", ["-rf", tmp]);
  }
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exitCode = main();
}
