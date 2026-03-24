import type {
  SpeechToTextActiveDownload,
  SpeechToTextAppendAudioBatchInput,
  SpeechToTextCancelSessionInput,
  SpeechToTextSettings,
  SpeechToTextAudioChunk,
  SpeechToTextSessionEvent,
  SpeechToTextState,
  SpeechToTextStartSessionResult,
  SpeechToTextStopSessionInput,
  SpeechToTextUpdatePreferencesInput,
} from "@samscode/contracts";
import type { Effect, Stream } from "effect";

export interface SpeechToTextShape {
  readonly start: Effect.Effect<void>;
  readonly getState: Effect.Effect<SpeechToTextState>;
  readonly downloadModel: (input: { modelId: string }) => Effect.Effect<SpeechToTextState>;
  readonly deleteModel: (input: { modelId: string }) => Effect.Effect<SpeechToTextState>;
  readonly selectModel: (input: { modelId: string }) => Effect.Effect<SpeechToTextState>;
  readonly updatePreferences: (
    input: SpeechToTextUpdatePreferencesInput,
  ) => Effect.Effect<SpeechToTextState>;
  readonly startSession: Effect.Effect<SpeechToTextStartSessionResult>;
  readonly appendAudioBatch: (input: SpeechToTextAppendAudioBatchInput) => Effect.Effect<void>;
  readonly stopSession: (input: SpeechToTextStopSessionInput) => Effect.Effect<void>;
  readonly cancelSession: (input: SpeechToTextCancelSessionInput) => Effect.Effect<void>;
  readonly streamChanges: Stream.Stream<SpeechToTextState>;
  readonly streamSessionEvents: Stream.Stream<SpeechToTextSessionEvent>;
}

export interface SpeechToTextConfigRecord {
  readonly selectedModelId: string | null;
  readonly settings: SpeechToTextSettings;
}

export interface SpeechToTextPaths {
  readonly rootDir: string;
  readonly configPath: string;
  readonly modelsDir: string;
  readonly resourcesDir: string;
  readonly vadModelPath: string;
  readonly runtimeRootDir: string;
  readonly runtimePlatformDir: string;
  readonly runtimeManifestPath: string;
  readonly downloadsDir: string;
  readonly tmpDir: string;
}

export interface SpeechToTextMutableState {
  activeDownload: SpeechToTextActiveDownload | null;
  errorMessage: string | null;
  runtimeErrorMessage: string | null;
}

export interface SpeechToTextSessionRecord {
  readonly id: string;
  readonly startedAt: number;
  readonly engine: string;
  readonly settings: SpeechToTextSettings;
  readonly selectedModelId: string;
  readonly language: string;
  readonly prompt: string;
  readonly primaryResources: SpeechToTextResolvedResources;
  readonly draftResources: SpeechToTextResolvedResources | null;
  nextSequence: number;
  segmentIndex: number;
  totalAudioMs: number;
  totalBatches: number;
  partialText: string;
  draftSegments: string[];
  isStopping: boolean;
  detectedSpeech: boolean;
  speechDurationMs: number;
  silenceDurationMs: number;
  utteranceBuffers: Buffer[];
  utteranceDurationMs: number;
  sessionAudioBuffers: Buffer[];
  previewQueuedAtMs: number;
  previewInFlight: boolean;
  previewPending: boolean;
  completionPublished: boolean;
  stopRequestedAtMs: number | null;
  lastAppendCompletedAtMs: number | null;
  insertedDraftText: string | null;
  finalTranscript: string | null;
  draftDecodeMsTotal: number;
  refinementDecodeMsTotal: number;
  cleanupMsTotal: number;
  draftPassCount: number;
  refinementPassCount: number;
  endpointedSegmentCount: number;
  cleanupBackend: string | null;
  cleanupModel: string | null;
  finalizeChain: Promise<void>;
  lastError: string | null;
}

export interface SpeechToTextResolvedResources {
  readonly sidecarBinaryPath: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly modelPath: string;
  readonly settings: SpeechToTextSettings;
  readonly language: string;
  readonly prompt: string;
  readonly threads: number;
  readonly vadModelPath: string | undefined;
}

export interface SpeechToTextChunkAppendContext {
  readonly session: SpeechToTextSessionRecord;
  readonly chunk: SpeechToTextAudioChunk;
}

export interface RuntimePlatformTarget {
  readonly platformKey: string;
  readonly assetName: string;
  readonly binaryName: string;
  readonly supported: boolean;
  readonly displayName: string;
}

export interface RuntimeReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
  readonly size: number;
}

export interface RuntimeReleaseResponse {
  readonly tag_name: string;
  readonly assets: ReadonlyArray<RuntimeReleaseAsset>;
}

export interface RuntimeInstallationMetadata {
  readonly assetName: string;
  readonly tagName: string;
}
