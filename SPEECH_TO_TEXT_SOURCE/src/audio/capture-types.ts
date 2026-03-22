export interface AudioDeviceInfo {
  id: string;
  name: string;
  defaultSampleRate?: number;
  inputChannels?: number;
  hostApi?: string;
  isDefault?: boolean;
}

export interface StartCaptureOptions {
  deviceId?: string;
  sampleRate: 16000;
  channels: 1;
  bitDepth: 16;
  output?: {
    wavPath?: string;
    rawPath?: string;
  };
}

export interface AudioChunk {
  pcm: Buffer;
  timestampMs: number;
}

export interface CaptureStopResult {
  wavPath?: string;
  rawPath?: string;
  durationMs: number;
}
