export const SPEECH_START_RMS_THRESHOLD = 0.018;
export const SPEECH_CONTINUE_RMS_THRESHOLD = 0.012;
export const MIN_SPEECH_MS = 220;
export const PREVIEW_MIN_AUDIO_MS = 350;
export const PREVIEW_INTERVAL_MS = 700;

export function isSpeechChunk(input: { rms: number; alreadyDetectedSpeech: boolean }): boolean {
  const threshold = input.alreadyDetectedSpeech
    ? SPEECH_CONTINUE_RMS_THRESHOLD
    : SPEECH_START_RMS_THRESHOLD;
  return input.rms >= threshold;
}
