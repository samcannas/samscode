import path from "node:path";

export const MAX_SPEECH_TO_TEXT_RECORDING_MS = 90_000;
export const MAX_SPEECH_TO_TEXT_WAV_BYTES = 25 * 1024 * 1024;

export function decodeSpeechToTextWavBase64(wavBase64: string): Buffer {
  const bytes = Buffer.from(wavBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new Error("Speech-to-text audio payload is empty.");
  }
  if (bytes.byteLength > MAX_SPEECH_TO_TEXT_WAV_BYTES) {
    throw new Error("Speech-to-text audio payload exceeds the 25 MB limit.");
  }
  return bytes;
}

export function assertSpeechToTextWavPayload(bytes: Buffer): void {
  if (bytes.byteLength < 12) {
    throw new Error("Speech-to-text audio payload is not a valid WAV file.");
  }
  const riff = bytes.subarray(0, 4).toString("ascii");
  const wave = bytes.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Speech-to-text audio payload must be a WAV file.");
  }
}

export function sanitizeSpeechToTextFileName(fileName: string): string {
  const parsed = path.basename(fileName).replace(/[^A-Za-z0-9._-]/g, "-");
  return parsed.length > 0 ? parsed : "speech-to-text.wav";
}
