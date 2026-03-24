import { promises as fs } from "node:fs";
import path from "node:path";

import type { SpeechToTextSettings } from "@samscode/contracts";

import type { SpeechToTextConfigRecord } from "./types";

export const DEFAULT_SPEECH_TO_TEXT_SETTINGS: SpeechToTextSettings = {
  language: "en",
  prompt:
    "Transcribe directly into the composer. Preserve code terms, filenames, commands, punctuation, and casing when spoken.",
  useVad: true,
  endpointingEnabled: true,
  endpointSilenceMs: 300,
  partialTranscriptsEnabled: true,
  warmupEnabled: true,
  qualityProfile: "balanced",
  refinementMode: "refine-on-stop",
};

const DEFAULT_CONFIG: SpeechToTextConfigRecord = {
  selectedModelId: null,
  settings: DEFAULT_SPEECH_TO_TEXT_SETTINGS,
};

function normalizeSettings(input: unknown): SpeechToTextSettings {
  if (!input || typeof input !== "object") {
    return DEFAULT_SPEECH_TO_TEXT_SETTINGS;
  }

  const record = input as Record<string, unknown>;
  const language =
    typeof record.language === "string" && record.language.trim().length > 0
      ? record.language.trim()
      : DEFAULT_SPEECH_TO_TEXT_SETTINGS.language;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  const endpointSilenceMs =
    typeof record.endpointSilenceMs === "number" && Number.isInteger(record.endpointSilenceMs)
      ? Math.max(150, record.endpointSilenceMs)
      : DEFAULT_SPEECH_TO_TEXT_SETTINGS.endpointSilenceMs;
  const qualityProfile =
    record.qualityProfile === "fast" ||
    record.qualityProfile === "balanced" ||
    record.qualityProfile === "quality"
      ? record.qualityProfile
      : DEFAULT_SPEECH_TO_TEXT_SETTINGS.qualityProfile;
  const refinementMode =
    record.refinementMode === "draft-only" || record.refinementMode === "refine-on-stop"
      ? record.refinementMode
      : DEFAULT_SPEECH_TO_TEXT_SETTINGS.refinementMode;

  return {
    language,
    prompt,
    useVad:
      typeof record.useVad === "boolean" ? record.useVad : DEFAULT_SPEECH_TO_TEXT_SETTINGS.useVad,
    endpointingEnabled:
      typeof record.endpointingEnabled === "boolean"
        ? record.endpointingEnabled
        : DEFAULT_SPEECH_TO_TEXT_SETTINGS.endpointingEnabled,
    endpointSilenceMs,
    partialTranscriptsEnabled:
      typeof record.partialTranscriptsEnabled === "boolean"
        ? record.partialTranscriptsEnabled
        : DEFAULT_SPEECH_TO_TEXT_SETTINGS.partialTranscriptsEnabled,
    warmupEnabled:
      typeof record.warmupEnabled === "boolean"
        ? record.warmupEnabled
        : DEFAULT_SPEECH_TO_TEXT_SETTINGS.warmupEnabled,
    qualityProfile,
    refinementMode,
  };
}

function normalizeConfig(input: unknown): SpeechToTextConfigRecord {
  if (!input || typeof input !== "object") {
    return DEFAULT_CONFIG;
  }

  const record = input as Record<string, unknown>;
  const selectedModelId =
    typeof record.selectedModelId === "string" && record.selectedModelId.trim().length > 0
      ? record.selectedModelId.trim()
      : null;

  return {
    selectedModelId,
    settings: normalizeSettings(record.settings),
  };
}

export function createSpeechToTextConfigStore(configPath: string) {
  return {
    async load(): Promise<SpeechToTextConfigRecord> {
      try {
        const raw = await fs.readFile(configPath, "utf8");
        return normalizeConfig(JSON.parse(raw));
      } catch {
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
