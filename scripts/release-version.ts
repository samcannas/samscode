import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  releasePackageFiles,
  updateReleasePackageVersions,
} from "./update-release-package-versions.ts";

function parseVersion(argv: ReadonlyArray<string>): string {
  const version = argv[0]?.trim();
  if (!version) {
    throw new Error("Usage: bun run release:version -- <version>");
  }

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }

  return version;
}

function run(command: string, args: ReadonlyArray<string>, cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
    shell: false,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    const rendered = [command, ...args].join(" ");
    throw new Error(`Command failed: ${rendered}`);
  }

  return result.stdout ?? "";
}

function parseDirtyPaths(statusOutput: string): string[] {
  return statusOutput
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim())
    .map((line) => {
      const renamedParts = line.split(" -> ");
      return renamedParts[renamedParts.length - 1] ?? line;
    });
}

function releaseFilesAlreadyMatch(version: string, cwd: string): boolean {
  return releasePackageFiles.every((relativePath) => {
    const packageJson = JSON.parse(readFileSync(resolve(cwd, relativePath), "utf8")) as {
      version?: unknown;
    };
    return packageJson.version === version;
  });
}

function ensureWorktreeReady(version: string, cwd: string): void {
  const statusOutput = run("git", ["status", "--short"], cwd).trim();
  if (statusOutput.length === 0) {
    return;
  }

  const allowedPaths = new Set([...releasePackageFiles, "bun.lock"]);
  const dirtyPaths = parseDirtyPaths(statusOutput);
  const onlyReleaseFilesDirty = dirtyPaths.every((relativePath) => allowedPaths.has(relativePath));

  if (onlyReleaseFilesDirty && releaseFilesAlreadyMatch(version, cwd)) {
    return;
  }

  throw new Error("Git worktree must be clean before running release:version.");
}

function ensureTagDoesNotExist(version: string, cwd: string): void {
  const tagName = `v${version}`;
  const result = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tagName}`], {
    cwd,
    stdio: "ignore",
    shell: false,
  });

  if (result.status === 0) {
    throw new Error(`Git tag already exists: ${tagName}`);
  }
}

function stageReleaseFiles(cwd: string): void {
  run("git", ["add", ...releasePackageFiles, "bun.lock"], cwd);
}

function main(): void {
  const version = parseVersion(process.argv.slice(2));
  const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

  ensureWorktreeReady(version, rootDir);
  ensureTagDoesNotExist(version, rootDir);

  const { changed } = updateReleasePackageVersions(version, { rootDir });
  run("bun", ["install", "--lockfile-only", "--ignore-scripts"], rootDir);

  if (!changed) {
    const status = run(
      "git",
      ["status", "--short", "--", ...releasePackageFiles, "bun.lock"],
      rootDir,
    ).trim();
    if (status.length === 0) {
      throw new Error(`Release files already match version ${version}.`);
    }
  }

  stageReleaseFiles(rootDir);
  run("git", ["commit", "-m", `Bump version to ${version}`], rootDir);
  run("git", ["push"], rootDir);
  run("git", ["tag", `v${version}`], rootDir);
  run("git", ["push", "origin", `v${version}`], rootDir);
}

main();
