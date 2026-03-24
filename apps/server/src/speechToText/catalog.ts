import type { SpeechToTextModelCatalogEntry } from "@samscode/contracts";

function mb(value: number): number {
  return Math.round(value * 1024 * 1024);
}

function gb(value: number): number {
  return Math.round(value * 1024 * 1024 * 1024);
}

const WHISPER_CPP_HF_REPO = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const DISTIL_WHISPER_HF_REPO =
  "https://huggingface.co/distil-whisper/distil-large-v3-ggml/resolve/main";

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
    recommended: false,
    description: "Entry multilingual model for low-memory local transcription.",
    sizeBytes: mb(148),
  },
  {
    id: "ggml-base.en.bin",
    fileName: "ggml-base.en.bin",
    name: "Base English",
    language: "english",
    recommended: false,
    description: "Entry English model for low-memory local dictation.",
    sizeBytes: mb(148),
  },
  {
    id: "ggml-distil-large-v3.bin",
    fileName: "ggml-distil-large-v3.bin",
    name: "Distil Large v3",
    language: "english",
    recommended: true,
    description: "Recommended English model for fast, high-quality dictation.",
    sizeBytes: gb(1.52),
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
    recommended: true,
    description: "Recommended multilingual model for strong dictation quality and speed.",
    sizeBytes: mb(574),
  },
];

const catalogById = new Map(SPEECH_TO_TEXT_MODEL_CATALOG.map((entry) => [entry.id, entry]));

export function getSpeechToTextCatalogEntry(modelId: string): SpeechToTextModelCatalogEntry | null {
  return catalogById.get(modelId) ?? null;
}

export function resolveSpeechToTextModelDownloadUrl(fileName: string): string {
  if (fileName === "ggml-distil-large-v3.bin") {
    return `${DISTIL_WHISPER_HF_REPO}/${encodeURIComponent(fileName)}?download=true`;
  }

  return `${WHISPER_CPP_HF_REPO}/${encodeURIComponent(fileName)}?download=true`;
}

export const DEFAULT_ENGLISH_SPEECH_TO_TEXT_MODEL_ID = "ggml-distil-large-v3.bin";
export const DEFAULT_MULTILINGUAL_SPEECH_TO_TEXT_MODEL_ID = "ggml-large-v3-turbo-q5_0.bin";
