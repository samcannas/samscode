import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSpeechToTextConfigStore } from "./configStore";

describe("speechToText configStore", () => {
  it("persists and reloads the selected model", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "speech-config-"));
    const configPath = path.join(tempDir, "config.json");
    const store = createSpeechToTextConfigStore(configPath);

    await store.save({ selectedModelId: "ggml-base.en.bin" });

    await expect(store.load()).resolves.toEqual({
      selectedModelId: "ggml-base.en.bin",
    });
  });

  it("falls back to null selection for malformed config", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "speech-config-"));
    const configPath = path.join(tempDir, "config.json");
    await fs.writeFile(configPath, "{not-json", "utf8");
    const store = createSpeechToTextConfigStore(configPath);

    await expect(store.load()).resolves.toEqual({ selectedModelId: null });
  });
});
