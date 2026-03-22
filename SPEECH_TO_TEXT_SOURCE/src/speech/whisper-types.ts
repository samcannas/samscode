export interface WhisperTranscribeOptions {
  modelPath: string;
  language?: string;
  prompt?: string;
  useVad?: boolean;
  vadModelPath?: string;
  threads?: number;
  temperature?: number;
}

export interface TranscriptionResult {
  text: string;
  elapsedMs: number;
  engine: "whisper.cpp";
}
