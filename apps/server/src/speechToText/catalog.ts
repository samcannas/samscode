import type { SpeechToTextModelCatalogEntry } from "@samscode/contracts";

function mb(value: number): number {
  return Math.round(value * 1024 * 1024);
}

function gb(value: number): number {
  return Math.round(value * 1024 * 1024 * 1024);
}

const WHISPER_CPP_HF_REPO = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const DISTIL_WHISPER_GGML_HF_REPO =
  "https://huggingface.co/distil-whisper/distil-large-v3-ggml/resolve/main";

export type SpeechToTextModelFamily = "whisper-ggml" | "whisper-ct2" | "parakeet-tdt";
export type SpeechToTextModelArtifactKind = "file" | "directory";
export type SpeechToTextEngineKind = "whisper.cpp" | "faster-whisper" | "parakeet-nemo";

export interface SpeechToTextModelDescriptor extends Omit<
  SpeechToTextModelCatalogEntry,
  "supportedOnCurrentSystem" | "supportHint"
> {
  readonly family: SpeechToTextModelFamily;
  readonly artifactKind: SpeechToTextModelArtifactKind;
  readonly engineKind: SpeechToTextEngineKind;
  readonly modelRef: string;
  readonly downloadKind: "direct-url" | "hf-snapshot";
  readonly downloadSource: string;
}

const MODEL_DESCRIPTORS: ReadonlyArray<SpeechToTextModelDescriptor> = [
  {
    id: "ggml-base.bin",
    fileName: "ggml-base.bin",
    name: "Base",
    family: "whisper-ggml",
    language: "multilingual",
    recommended: false,
    description: "Entry multilingual model for low-memory local transcription.",
    sizeBytes: mb(148),
    artifactKind: "file",
    engineKind: "whisper.cpp",
    modelRef: "ggml-base.bin",
    downloadKind: "direct-url",
    downloadSource: `${WHISPER_CPP_HF_REPO}/ggml-base.bin?download=true`,
  },
  {
    id: "ggml-base.en.bin",
    fileName: "ggml-base.en.bin",
    name: "Base English",
    family: "whisper-ggml",
    language: "english",
    recommended: false,
    description: "Entry English model for low-memory local dictation.",
    sizeBytes: mb(148),
    artifactKind: "file",
    engineKind: "whisper.cpp",
    modelRef: "ggml-base.en.bin",
    downloadKind: "direct-url",
    downloadSource: `${WHISPER_CPP_HF_REPO}/ggml-base.en.bin?download=true`,
  },
  {
    id: "ggml-distil-large-v3.bin",
    fileName: "ggml-distil-large-v3.bin",
    name: "Distil Large v3 (GGML)",
    family: "whisper-ggml",
    language: "english",
    recommended: false,
    description: "GGML Distil Whisper for whisper.cpp CPU or Metal fallback.",
    sizeBytes: gb(1.52),
    artifactKind: "file",
    engineKind: "whisper.cpp",
    modelRef: "ggml-distil-large-v3.bin",
    downloadKind: "direct-url",
    downloadSource: `${DISTIL_WHISPER_GGML_HF_REPO}/ggml-distil-large-v3.bin?download=true`,
  },
  {
    id: "ggml-large-v3.bin",
    fileName: "ggml-large-v3.bin",
    name: "Large v3",
    family: "whisper-ggml",
    language: "multilingual",
    recommended: false,
    description: "Latest high-accuracy multilingual model.",
    sizeBytes: gb(3.1),
    artifactKind: "file",
    engineKind: "whisper.cpp",
    modelRef: "ggml-large-v3.bin",
    downloadKind: "direct-url",
    downloadSource: `${WHISPER_CPP_HF_REPO}/ggml-large-v3.bin?download=true`,
  },
  {
    id: "ggml-large-v3-turbo.bin",
    fileName: "ggml-large-v3-turbo.bin",
    name: "Large v3 Turbo",
    family: "whisper-ggml",
    language: "multilingual",
    recommended: false,
    description: "Faster large multilingual model with strong quality.",
    sizeBytes: gb(1.62),
    artifactKind: "file",
    engineKind: "whisper.cpp",
    modelRef: "ggml-large-v3-turbo.bin",
    downloadKind: "direct-url",
    downloadSource: `${WHISPER_CPP_HF_REPO}/ggml-large-v3-turbo.bin?download=true`,
  },
  {
    id: "ggml-large-v3-turbo-q5_0.bin",
    fileName: "ggml-large-v3-turbo-q5_0.bin",
    name: "Large v3 Turbo Q5",
    family: "whisper-ggml",
    language: "multilingual",
    recommended: false,
    description: "Recommended multilingual model for strong dictation quality and speed.",
    sizeBytes: mb(574),
    artifactKind: "file",
    engineKind: "whisper.cpp",
    modelRef: "ggml-large-v3-turbo-q5_0.bin",
    downloadKind: "direct-url",
    downloadSource: `${WHISPER_CPP_HF_REPO}/ggml-large-v3-turbo-q5_0.bin?download=true`,
  },
  {
    id: "fw-distil-large-v3",
    fileName: "fw-distil-large-v3",
    name: "Distil Large v3 (CUDA)",
    family: "whisper-ct2",
    language: "english",
    recommended: true,
    description: "Recommended CUDA faster-whisper model for fast English dictation.",
    sizeBytes: gb(1.52),
    artifactKind: "directory",
    engineKind: "faster-whisper",
    modelRef: "Systran/faster-distil-whisper-large-v3",
    downloadKind: "hf-snapshot",
    downloadSource: "Systran/faster-distil-whisper-large-v3",
  },
  {
    id: "fw-large-v3",
    fileName: "fw-large-v3",
    name: "Large v3 (CUDA)",
    family: "whisper-ct2",
    language: "multilingual",
    recommended: false,
    description: "CTranslate2 Whisper Large v3 for faster-whisper CUDA acceleration.",
    sizeBytes: gb(3.1),
    artifactKind: "directory",
    engineKind: "faster-whisper",
    modelRef: "Systran/faster-whisper-large-v3",
    downloadKind: "hf-snapshot",
    downloadSource: "Systran/faster-whisper-large-v3",
  },
  {
    id: "parakeet-tdt-0.6b-v2",
    fileName: "parakeet-tdt-0.6b-v2",
    name: "Parakeet TDT 0.6B v2",
    family: "parakeet-tdt",
    language: "english",
    recommended: true,
    description: "NVIDIA NeMo English Parakeet TDT model for CUDA-accelerated dictation.",
    sizeBytes: gb(2.2),
    artifactKind: "directory",
    engineKind: "parakeet-nemo",
    modelRef: "nvidia/parakeet-tdt-0.6b-v2",
    downloadKind: "hf-snapshot",
    downloadSource: "nvidia/parakeet-tdt-0.6b-v2",
  },
  {
    id: "parakeet-tdt-0.6b-v3",
    fileName: "parakeet-tdt-0.6b-v3",
    name: "Parakeet TDT 0.6B v3",
    family: "parakeet-tdt",
    language: "multilingual",
    recommended: true,
    description: "NVIDIA NeMo multilingual Parakeet TDT model for CUDA-accelerated dictation.",
    sizeBytes: gb(2.4),
    artifactKind: "directory",
    engineKind: "parakeet-nemo",
    modelRef: "nvidia/parakeet-tdt-0.6b-v3",
    downloadKind: "hf-snapshot",
    downloadSource: "nvidia/parakeet-tdt-0.6b-v3",
  },
];

export const SPEECH_TO_TEXT_MODEL_CATALOG: ReadonlyArray<SpeechToTextModelCatalogEntry> =
  MODEL_DESCRIPTORS.map(
    ({
      artifactKind: _,
      engineKind: __,
      modelRef: ___,
      downloadKind: ____,
      downloadSource: _____,
      ...entry
    }) => ({
      ...entry,
      supportedOnCurrentSystem: false,
      supportHint: null,
    }),
  );

const catalogById = new Map(MODEL_DESCRIPTORS.map((entry) => [entry.id, entry]));

export function getSpeechToTextCatalogEntry(modelId: string): SpeechToTextModelCatalogEntry | null {
  const descriptor = catalogById.get(modelId);
  if (!descriptor) {
    return null;
  }
  const {
    artifactKind: _,
    engineKind: __,
    modelRef: ___,
    downloadKind: ____,
    downloadSource: _____,
    ...entry
  } = descriptor;
  return {
    ...entry,
    supportedOnCurrentSystem: false,
    supportHint: null,
  };
}

export function getSpeechToTextModelDescriptor(
  modelId: string,
): SpeechToTextModelDescriptor | null {
  return catalogById.get(modelId) ?? null;
}

export function resolveSpeechToTextModelDownload(modelId: string): {
  kind: SpeechToTextModelDescriptor["downloadKind"];
  source: string;
} {
  const descriptor = getSpeechToTextModelDescriptor(modelId);
  if (!descriptor) {
    throw new Error(`Unknown speech-to-text model: ${modelId}`);
  }
  return {
    kind: descriptor.downloadKind,
    source: descriptor.downloadSource,
  };
}

export const DEFAULT_ENGLISH_SPEECH_TO_TEXT_MODEL_ID = "fw-distil-large-v3";
export const DEFAULT_MULTILINGUAL_SPEECH_TO_TEXT_MODEL_ID = "ggml-large-v3-turbo-q5_0.bin";
