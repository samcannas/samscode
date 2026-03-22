import type {
  SpeechToTextActiveDownload,
  SpeechToTextState,
  SpeechToTextTranscriptionResult,
} from "@samscode/contracts";
import type { Effect, Stream } from "effect";

export interface SpeechToTextShape {
  readonly start: Effect.Effect<void>;
  readonly getState: Effect.Effect<SpeechToTextState>;
  readonly downloadModel: (input: { modelId: string }) => Effect.Effect<SpeechToTextState>;
  readonly deleteModel: (input: { modelId: string }) => Effect.Effect<SpeechToTextState>;
  readonly selectModel: (input: { modelId: string }) => Effect.Effect<SpeechToTextState>;
  readonly transcribeWav: (input: {
    wavBase64: string;
    fileName: string;
  }) => Effect.Effect<SpeechToTextTranscriptionResult>;
  readonly streamChanges: Stream.Stream<SpeechToTextState>;
}

export interface SpeechToTextConfigRecord {
  readonly selectedModelId: string | null;
}

export interface SpeechToTextPaths {
  readonly rootDir: string;
  readonly configPath: string;
  readonly modelsDir: string;
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
