import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildRuntimeArchiveTempPath,
  isRuntimeInstallationCompatible,
  writeRuntimeInstallationMetadata,
} from "./runtimeResolver";

describe("speechToText runtimeResolver", () => {
  it("preserves a zip extension for temporary runtime archives", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234567890);

    const archivePath = buildRuntimeArchiveTempPath("C:\\tmp", "whisper-bin-Win32.zip");

    expect(archivePath).toBe(path.join("C:\\tmp", "whisper-bin-Win32.1234567890.tmp.zip"));
  });

  it("treats legacy win32-x64 runtimes without metadata as incompatible", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "speech-runtime-"));

    await expect(
      isRuntimeInstallationCompatible({
        runtimeManifestPath: path.join(tempDir, "runtime-manifest.json"),
        target: {
          platformKey: "win32-x64",
          assetName: "whisper-bin-x64.zip",
          binaryName: "whisper-cli.exe",
          supported: true,
          displayName: "Windows x64",
        },
      }),
    ).resolves.toBe(false);
  });

  it("accepts runtimes with matching metadata", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "speech-runtime-"));
    const manifestPath = path.join(tempDir, "runtime-manifest.json");
    await writeRuntimeInstallationMetadata(manifestPath, {
      assetName: "whisper-bin-x64.zip",
      tagName: "v1.8.4",
    });

    await expect(
      isRuntimeInstallationCompatible({
        runtimeManifestPath: manifestPath,
        target: {
          platformKey: "win32-x64",
          assetName: "whisper-bin-x64.zip",
          binaryName: "whisper-cli.exe",
          supported: true,
          displayName: "Windows x64",
        },
      }),
    ).resolves.toBe(true);
  });
});
