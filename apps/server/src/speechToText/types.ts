import type {
  SpeechToTextActiveDownload,
  SpeechToTextAppendAudioInput,
  SpeechToTextCancelSessionInput,
  SpeechToTextSessionEvent,
  SpeechToTextSettings,
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
  readonly appendAudio: (input: SpeechToTextAppendAudioInput) => Effect.Effect<void>;
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
  nextSequence: number;
  segmentIndex: number;
  totalAudioMs: number;
  partialText: string;
  committedSegments: string[];
  isStopping: boolean;
  detectedSpeech: boolean;
  speechDurationMs: number;
  silenceDurationMs: number;
  utteranceBuffers: Buffer[];
  utteranceDurationMs: number;
  previewQueuedAtMs: number;
  finalizeChain: Promise<void>;
  lastError: string | null;
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
