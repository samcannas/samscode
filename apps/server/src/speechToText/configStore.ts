import { promises as fs } from "node:fs";
import path from "node:path";

import type { SpeechToTextConfigRecord } from "./types";

const DEFAULT_CONFIG: SpeechToTextConfigRecord = {
  selectedModelId: null,
};

function normalizeConfig(input: unknown): SpeechToTextConfigRecord {
  if (!input || typeof input !== "object") {
    return DEFAULT_CONFIG;
  }

  const selectedModelId =
    "selectedModelId" in input &&
    (input as { selectedModelId?: unknown }).selectedModelId !== undefined
      ? (input as { selectedModelId?: unknown }).selectedModelId
      : null;

  return {
    selectedModelId:
      typeof selectedModelId === "string" && selectedModelId.trim().length > 0
        ? selectedModelId.trim()
        : null,
  };
}

export function createSpeechToTextConfigStore(configPath: string) {
  return {
    async load(): Promise<SpeechToTextConfigRecord> {
      try {
        const raw = await fs.readFile(configPath, "utf8");
        return normalizeConfig(JSON.parse(raw));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return DEFAULT_CONFIG;
        }
        return DEFAULT_CONFIG;
      }
    },

    async save(config: SpeechToTextConfigRecord): Promise<void> {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
      const contents = `${JSON.stringify(normalizeConfig(config), null, 2)}\n`;
      await fs.writeFile(tempPath, contents, "utf8");
      await fs.rename(tempPath, configPath);
    },
  };
}
