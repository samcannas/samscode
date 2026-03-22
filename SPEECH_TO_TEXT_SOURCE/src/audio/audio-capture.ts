import type { AudioChunk, AudioDeviceInfo, CaptureStopResult, StartCaptureOptions } from "./capture-types.js";

export interface AudioCapture {
  listInputDevices(): Promise<AudioDeviceInfo[]>;
  start(options: StartCaptureOptions): Promise<void>;
  stop(): Promise<CaptureStopResult>;
  onChunk(listener: (chunk: AudioChunk) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  isCapturing(): boolean;
}
