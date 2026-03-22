import type { TranscriptionResult, WhisperTranscribeOptions } from "./whisper-types.js";

export interface SpeechTranscriber {
  transcribeWav(audioPath: string, options: WhisperTranscribeOptions): Promise<TranscriptionResult>;
}
