import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearPersistedDesktopUpdateHint,
  readPersistedDesktopUpdateHint,
  writePersistedDesktopUpdateHint,
} from "./updatePersistence";

const tempDirs = new Set<string>();

afterEach(() => {
  for (const dir of tempDirs) {
    FS.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

function createTempFilePath(): string {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "samscode-update-persistence-"));
  tempDirs.add(dir);
  return Path.join(dir, "desktop-update-hint.json");
}

describe("updatePersistence", () => {
  it("writes and reads persisted update hints", () => {
    const filePath = createTempFilePath();
    writePersistedDesktopUpdateHint(filePath, {
      version: "1.1.0",
      releaseName: "Sam's Code 1.1.0",
      releaseNotes: "Adds updater prompts.",
      availableSizeBytes: 2048,
      downloadedAt: "2026-03-04T00:00:00.000Z",
    });

    expect(readPersistedDesktopUpdateHint(filePath)).toEqual({
      version: "1.1.0",
      releaseName: "Sam's Code 1.1.0",
      releaseNotes: "Adds updater prompts.",
      availableSizeBytes: 2048,
      downloadedAt: "2026-03-04T00:00:00.000Z",
    });
  });

  it("returns null for invalid persisted payloads", () => {
    const filePath = createTempFilePath();
    FS.mkdirSync(Path.dirname(filePath), { recursive: true });
    FS.writeFileSync(filePath, '{"version":42}\n', "utf8");

    expect(readPersistedDesktopUpdateHint(filePath)).toBeNull();
  });

  it("clears persisted update hints", () => {
    const filePath = createTempFilePath();
    writePersistedDesktopUpdateHint(filePath, {
      version: "1.1.0",
      releaseName: null,
      releaseNotes: null,
      availableSizeBytes: null,
      downloadedAt: "2026-03-04T00:00:00.000Z",
    });

    clearPersistedDesktopUpdateHint(filePath);

    expect(readPersistedDesktopUpdateHint(filePath)).toBeNull();
  });
});
