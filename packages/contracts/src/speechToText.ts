import { Schema } from "effect";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const SpeechToTextRuntimeStatus = Schema.Literals([
  "ready",
  "downloading",
  "missing",
  "error",
]);
export type SpeechToTextRuntimeStatus = typeof SpeechToTextRuntimeStatus.Type;

export const SpeechToTextModelCatalogEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  fileName: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  language: Schema.Literals(["english", "multilingual"]),
  recommended: Schema.Boolean,
  description: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
});
export type SpeechToTextModelCatalogEntry = typeof SpeechToTextModelCatalogEntry.Type;

export const SpeechToTextInstalledModel = Schema.Struct({
  id: TrimmedNonEmptyString,
  fileName: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  installedAt: TrimmedNonEmptyString,
  selected: Schema.Boolean,
});
export type SpeechToTextInstalledModel = typeof SpeechToTextInstalledModel.Type;

export const SpeechToTextDownloadPhase = Schema.Literals([
  "idle",
  "downloading-runtime",
  "downloading-model",
  "extracting-runtime",
  "completed",
  "error",
]);
export type SpeechToTextDownloadPhase = typeof SpeechToTextDownloadPhase.Type;

export const SpeechToTextActiveDownload = Schema.Struct({
  type: Schema.Literals(["runtime", "model"]),
  phase: SpeechToTextDownloadPhase,
  modelId: Schema.optional(TrimmedNonEmptyString),
  downloadedBytes: NonNegativeInt,
  totalBytes: Schema.NullOr(NonNegativeInt),
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type SpeechToTextActiveDownload = typeof SpeechToTextActiveDownload.Type;

export const SpeechToTextState = Schema.Struct({
  available: Schema.Boolean,
  runtimeStatus: SpeechToTextRuntimeStatus,
  selectedModelId: Schema.NullOr(TrimmedNonEmptyString),
  installedModels: Schema.Array(SpeechToTextInstalledModel),
  catalog: Schema.Array(SpeechToTextModelCatalogEntry),
  activeDownload: Schema.NullOr(SpeechToTextActiveDownload),
  errorMessage: Schema.NullOr(TrimmedNonEmptyString),
});
export type SpeechToTextState = typeof SpeechToTextState.Type;

export const SpeechToTextGetStateInput = Schema.Struct({});
export type SpeechToTextGetStateInput = typeof SpeechToTextGetStateInput.Type;

export const SpeechToTextDownloadModelInput = Schema.Struct({
  modelId: TrimmedNonEmptyString,
});
export type SpeechToTextDownloadModelInput = typeof SpeechToTextDownloadModelInput.Type;

export const SpeechToTextDeleteModelInput = Schema.Struct({
  modelId: TrimmedNonEmptyString,
});
export type SpeechToTextDeleteModelInput = typeof SpeechToTextDeleteModelInput.Type;

export const SpeechToTextSelectModelInput = Schema.Struct({
  modelId: TrimmedNonEmptyString,
});
export type SpeechToTextSelectModelInput = typeof SpeechToTextSelectModelInput.Type;

export const SpeechToTextTranscribeWavInput = Schema.Struct({
  wavBase64: TrimmedNonEmptyString,
  fileName: TrimmedNonEmptyString,
});
export type SpeechToTextTranscribeWavInput = typeof SpeechToTextTranscribeWavInput.Type;

export const SpeechToTextTranscriptionResult = Schema.Struct({
  text: TrimmedNonEmptyString,
  modelId: TrimmedNonEmptyString,
  elapsedMs: NonNegativeInt,
});
export type SpeechToTextTranscriptionResult = typeof SpeechToTextTranscriptionResult.Type;
