import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveCliBinary } from "./resolveCliBinary";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function touch(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "");
}

describe("resolveCliBinary", () => {
  it("prefers external PATH entries over node_modules bins", () => {
    const repoBin = path.join(makeTempDir("samscode-repo-"), "node_modules", ".bin");
    const userBin = makeTempDir("samscode-user-");
    const executableName = process.platform === "win32" ? "codex.exe" : "codex";

    touch(path.join(repoBin, executableName));
    touch(path.join(userBin, executableName));

    const resolved = resolveCliBinary("codex", {
      ...process.env,
      PATH: [repoBin, userBin].join(path.delimiter),
    });

    expect(resolved).toBe(path.join(userBin, executableName));
  });

  it("falls back to node_modules bin when no external candidate exists", () => {
    const repoBin = path.join(makeTempDir("samscode-repo-"), "node_modules", ".bin");
    const executableName = process.platform === "win32" ? "codex.exe" : "codex";

    touch(path.join(repoBin, executableName));

    const resolved = resolveCliBinary("codex", {
      ...process.env,
      PATH: repoBin,
    });

    expect(resolved).toBe(path.join(repoBin, executableName));
  });
});
