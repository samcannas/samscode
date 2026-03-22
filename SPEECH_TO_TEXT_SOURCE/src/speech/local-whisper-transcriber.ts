import type { SpeechTranscriber } from "./speech-transcriber.js";
import type { TranscriptionResult, WhisperTranscribeOptions } from "./whisper-types.js";
import { WhisperProcessTranscriber } from "./whisper-process.js";

export class LocalWhisperTranscriber implements SpeechTranscriber {
  private readonly transcriber: WhisperProcessTranscriber;

  constructor(transcriber = new WhisperProcessTranscriber()) {
    this.transcriber = transcriber;
  }

  transcribeWav(audioPath: string, options: WhisperTranscribeOptions): Promise<TranscriptionResult> {
    return this.transcriber.transcribeWav(audioPath, options);
  }
}
