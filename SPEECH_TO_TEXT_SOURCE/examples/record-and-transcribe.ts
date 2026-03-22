import { DictationSession, LocalWhisperTranscriber, NaudiodonAudioCapture } from "../src/index.js";

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error("Usage: tsx examples/record-and-transcribe.ts <model-path>");
}

const session = new DictationSession({
  capture: new NaudiodonAudioCapture(),
  transcriber: new LocalWhisperTranscriber(),
  options: {
    capture: {
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
    },
    transcription: {
      modelPath,
    },
    autoInsert: false,
  },
});

console.log("Recording for 5 seconds...");
await session.start();
await new Promise((resolve) => setTimeout(resolve, 5000));
const result = await session.stop();
console.log(result);
