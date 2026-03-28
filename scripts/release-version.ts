import { spawnSync } from "node:child_process";
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
    shell: process.platform === "win32",
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

function ensureCleanWorktree(cwd: string): void {
  const status = run("git", ["status", "--short"], cwd).trim();
  if (status.length > 0) {
    throw new Error("Git worktree must be clean before running release:version.");
  }
}

function ensureTagDoesNotExist(version: string, cwd: string): void {
  const tagName = `v${version}`;
  const result = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tagName}`], {
    cwd,
    stdio: "ignore",
    shell: process.platform === "win32",
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

  ensureCleanWorktree(rootDir);
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
