import type { SpeechToTextModelCatalogEntry } from "@samscode/contracts";

function mb(value: number): number {
  return Math.round(value * 1024 * 1024);
}

function gb(value: number): number {
  return Math.round(value * 1024 * 1024 * 1024);
}

export const SPEECH_TO_TEXT_MODEL_CATALOG: ReadonlyArray<SpeechToTextModelCatalogEntry> = [
  {
    id: "ggml-tiny.bin",
    fileName: "ggml-tiny.bin",
    name: "Tiny",
    language: "multilingual",
    recommended: false,
    description: "Smallest multilingual model for fast local transcription.",
    sizeBytes: mb(77.7),
  },
  {
    id: "ggml-tiny.en.bin",
    fileName: "ggml-tiny.en.bin",
    name: "Tiny English",
    language: "english",
    recommended: false,
    description: "Fast English-only model for lightweight dictation.",
    sizeBytes: mb(77.7),
  },
  {
    id: "ggml-base.bin",
    fileName: "ggml-base.bin",
    name: "Base",
    language: "multilingual",
    recommended: true,
    description: "Recommended multilingual model balancing speed and quality.",
    sizeBytes: mb(148),
  },
  {
    id: "ggml-base.en.bin",
    fileName: "ggml-base.en.bin",
    name: "Base English",
    language: "english",
    recommended: true,
    description: "Recommended English model for everyday local dictation.",
    sizeBytes: mb(148),
  },
  {
    id: "ggml-large-v2.bin",
    fileName: "ggml-large-v2.bin",
    name: "Large v2",
    language: "multilingual",
    recommended: false,
    description: "High-accuracy multilingual model with larger runtime cost.",
    sizeBytes: gb(3.09),
  },
  {
    id: "ggml-large-v3.bin",
    fileName: "ggml-large-v3.bin",
    name: "Large v3",
    language: "multilingual",
    recommended: false,
    description: "Latest high-accuracy multilingual model.",
    sizeBytes: gb(3.1),
  },
  {
    id: "ggml-large-v3-turbo.bin",
    fileName: "ggml-large-v3-turbo.bin",
    name: "Large v3 Turbo",
    language: "multilingual",
    recommended: false,
    description: "Faster large multilingual model with strong quality.",
    sizeBytes: gb(1.62),
  },
  {
    id: "ggml-large-v3-turbo-q5_0.bin",
    fileName: "ggml-large-v3-turbo-q5_0.bin",
    name: "Large v3 Turbo Q5",
    language: "multilingual",
    recommended: false,
    description: "Quantized turbo model for lower memory usage.",
    sizeBytes: mb(574),
  },
];

const catalogById = new Map(SPEECH_TO_TEXT_MODEL_CATALOG.map((entry) => [entry.id, entry]));

export function getSpeechToTextCatalogEntry(modelId: string): SpeechToTextModelCatalogEntry | null {
  return catalogById.get(modelId) ?? null;
}

export const DEFAULT_ENGLISH_SPEECH_TO_TEXT_MODEL_ID = "ggml-base.en.bin";
export const DEFAULT_MULTILINGUAL_SPEECH_TO_TEXT_MODEL_ID = "ggml-base.bin";
