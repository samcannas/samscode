import type { StartCaptureOptions, AudioChunk } from "../audio/capture-types.js";
import type { InsertTextOptions } from "../text/text-inserter.js";
import type { WhisperTranscribeOptions, TranscriptionResult } from "../speech/whisper-types.js";

export interface DictationSessionOptions {
  capture: StartCaptureOptions;
  transcription: WhisperTranscribeOptions;
  insertion?: InsertTextOptions;
  autoInsert?: boolean;
}

export interface DictationSessionLike {
  start(): Promise<void>;
  stop(): Promise<TranscriptionResult>;
  cancel(): Promise<void>;
  onPartialAudio(listener: (chunk: AudioChunk) => void): () => void;
}
