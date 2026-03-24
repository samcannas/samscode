import { Schema } from "effect";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";

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
  type: Schema.Literals(["runtime", "model", "resource"]),
  phase: SpeechToTextDownloadPhase,
  modelId: Schema.optional(TrimmedNonEmptyString),
  resourceId: Schema.optional(TrimmedNonEmptyString),
  downloadedBytes: NonNegativeInt,
  totalBytes: Schema.NullOr(NonNegativeInt),
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type SpeechToTextActiveDownload = typeof SpeechToTextActiveDownload.Type;

export const SpeechToTextQualityProfile = Schema.Literals(["fast", "balanced", "quality"]);
export type SpeechToTextQualityProfile = typeof SpeechToTextQualityProfile.Type;

export const SpeechToTextRefinementMode = Schema.Literals(["draft-only", "refine-on-stop"]);
export type SpeechToTextRefinementMode = typeof SpeechToTextRefinementMode.Type;

export const SpeechToTextLanguage = Schema.Union([Schema.Literal("auto"), TrimmedNonEmptyString]);
export type SpeechToTextLanguage = typeof SpeechToTextLanguage.Type;

export const SpeechToTextSettings = Schema.Struct({
  language: SpeechToTextLanguage,
  prompt: TrimmedString,
  useVad: Schema.Boolean,
  endpointingEnabled: Schema.Boolean,
  endpointSilenceMs: PositiveInt,
  partialTranscriptsEnabled: Schema.Boolean,
  warmupEnabled: Schema.Boolean,
  qualityProfile: SpeechToTextQualityProfile,
  refinementMode: SpeechToTextRefinementMode,
  cleanupModel: Schema.NullOr(TrimmedNonEmptyString),
});
export type SpeechToTextSettings = typeof SpeechToTextSettings.Type;

export const SpeechToTextState = Schema.Struct({
  available: Schema.Boolean,
  runtimeStatus: SpeechToTextRuntimeStatus,
  runtimeBackend: Schema.NullOr(TrimmedNonEmptyString),
  runtimeAcceleration: Schema.NullOr(TrimmedNonEmptyString),
  selectedModelId: Schema.NullOr(TrimmedNonEmptyString),
  installedModels: Schema.Array(SpeechToTextInstalledModel),
  catalog: Schema.Array(SpeechToTextModelCatalogEntry),
  activeDownload: Schema.NullOr(SpeechToTextActiveDownload),
  settings: SpeechToTextSettings,
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

export const SpeechToTextUpdatePreferencesInput = SpeechToTextSettings;
export type SpeechToTextUpdatePreferencesInput = typeof SpeechToTextUpdatePreferencesInput.Type;

export const SpeechToTextSessionId = TrimmedNonEmptyString;
export type SpeechToTextSessionId = typeof SpeechToTextSessionId.Type;

export const SpeechToTextStartSessionInput = Schema.Struct({});
export type SpeechToTextStartSessionInput = typeof SpeechToTextStartSessionInput.Type;

export const SpeechToTextStartSessionResult = Schema.Struct({
  sessionId: SpeechToTextSessionId,
});
export type SpeechToTextStartSessionResult = typeof SpeechToTextStartSessionResult.Type;

export const SpeechToTextAudioChunk = Schema.Struct({
  sequence: NonNegativeInt,
  pcmBase64: TrimmedNonEmptyString,
  durationMs: PositiveInt,
});
export type SpeechToTextAudioChunk = typeof SpeechToTextAudioChunk.Type;

export const SpeechToTextAppendAudioBatchInput = Schema.Struct({
  sessionId: SpeechToTextSessionId,
  chunks: Schema.NonEmptyArray(SpeechToTextAudioChunk),
});
export type SpeechToTextAppendAudioBatchInput = typeof SpeechToTextAppendAudioBatchInput.Type;

export const SpeechToTextStopSessionInput = Schema.Struct({
  sessionId: SpeechToTextSessionId,
});
export type SpeechToTextStopSessionInput = typeof SpeechToTextStopSessionInput.Type;

export const SpeechToTextCancelSessionInput = Schema.Struct({
  sessionId: SpeechToTextSessionId,
});
export type SpeechToTextCancelSessionInput = typeof SpeechToTextCancelSessionInput.Type;

export const SpeechToTextSessionStartedEvent = Schema.Struct({
  type: Schema.Literal("started"),
  sessionId: SpeechToTextSessionId,
});
export type SpeechToTextSessionStartedEvent = typeof SpeechToTextSessionStartedEvent.Type;

export const SpeechToTextSessionProcessingEvent = Schema.Struct({
  type: Schema.Literal("processing"),
  sessionId: SpeechToTextSessionId,
  phase: Schema.Literals(["transcribing", "cleaningUp"]),
});
export type SpeechToTextSessionProcessingEvent = typeof SpeechToTextSessionProcessingEvent.Type;

export const SpeechToTextSessionPartialEvent = Schema.Struct({
  type: Schema.Literal("partial"),
  sessionId: SpeechToTextSessionId,
  segmentIndex: NonNegativeInt,
  text: TrimmedString,
});
export type SpeechToTextSessionPartialEvent = typeof SpeechToTextSessionPartialEvent.Type;

export const SpeechToTextSessionSegmentCommittedEvent = Schema.Struct({
  type: Schema.Literal("segmentCommitted"),
  sessionId: SpeechToTextSessionId,
  segmentIndex: NonNegativeInt,
  text: TrimmedNonEmptyString,
});
export type SpeechToTextSessionSegmentCommittedEvent =
  typeof SpeechToTextSessionSegmentCommittedEvent.Type;

export const SpeechToTextSessionFinalEvent = Schema.Struct({
  type: Schema.Literal("final"),
  stage: Schema.Literals(["rawFinal", "cleanedFinal"]),
  sessionId: SpeechToTextSessionId,
  text: TrimmedNonEmptyString,
  elapsedMs: NonNegativeInt,
  metrics: Schema.Struct({
    recordedAudioMs: NonNegativeInt,
    transportDrainMs: NonNegativeInt,
    totalFinalizeMs: NonNegativeInt,
    finalSttMs: NonNegativeInt,
    cleanupMs: NonNegativeInt,
    totalChunks: NonNegativeInt,
    totalBatches: NonNegativeInt,
    engine: TrimmedNonEmptyString,
    cleanupBackend: Schema.NullOr(TrimmedNonEmptyString),
    cleanupModel: Schema.NullOr(TrimmedNonEmptyString),
  }),
});
export type SpeechToTextSessionFinalEvent = typeof SpeechToTextSessionFinalEvent.Type;

export const SpeechToTextSessionEndedEvent = Schema.Struct({
  type: Schema.Literal("ended"),
  sessionId: SpeechToTextSessionId,
  reason: Schema.Literals(["completed", "cancelled", "error"]),
});
export type SpeechToTextSessionEndedEvent = typeof SpeechToTextSessionEndedEvent.Type;

export const SpeechToTextSessionErrorEvent = Schema.Struct({
  type: Schema.Literal("error"),
  sessionId: SpeechToTextSessionId,
  message: TrimmedNonEmptyString,
});
export type SpeechToTextSessionErrorEvent = typeof SpeechToTextSessionErrorEvent.Type;

export const SpeechToTextSessionEvent = Schema.Union([
  SpeechToTextSessionStartedEvent,
  SpeechToTextSessionProcessingEvent,
  SpeechToTextSessionPartialEvent,
  SpeechToTextSessionSegmentCommittedEvent,
  SpeechToTextSessionFinalEvent,
  SpeechToTextSessionEndedEvent,
  SpeechToTextSessionErrorEvent,
]);
export type SpeechToTextSessionEvent = typeof SpeechToTextSessionEvent.Type;
