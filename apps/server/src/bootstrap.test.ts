import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readBootstrapConfig } from "./bootstrap";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    try {
      FS.rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures in temp bootstrap fixtures.
    }
  }
});

function openBootstrapFd(content: string): number {
  const tempPath = Path.join(OS.tmpdir(), `samscode-bootstrap-${Date.now()}-${Math.random()}.json`);
  tempPaths.push(tempPath);
  FS.writeFileSync(tempPath, content, "utf8");
  return FS.openSync(tempPath, "r");
}

describe("readBootstrapConfig", () => {
  it("reads auth token bootstrap config from an inherited fd", () => {
    const fd = openBootstrapFd(JSON.stringify({ authToken: "secret-token" }));

    expect(readBootstrapConfig({ SAMSCODE_BOOTSTRAP_FD: String(fd) })).toEqual({
      authToken: "secret-token",
    });
  });

  it("returns an empty object when the bootstrap payload is invalid", () => {
    const fd = openBootstrapFd("{not-json");

    expect(readBootstrapConfig({ SAMSCODE_BOOTSTRAP_FD: String(fd) })).toEqual({});
  });
});
