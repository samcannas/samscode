import {
  DictationSession,
  LocalWhisperTranscriber,
  NaudiodonAudioCapture,
  createPlatformTextInserter,
} from "../src/index.js";

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error("Usage: tsx examples/dictate-and-paste.ts <model-path>");
}

const session = new DictationSession({
  capture: new NaudiodonAudioCapture(),
  transcriber: new LocalWhisperTranscriber(),
  textInserter: createPlatformTextInserter(),
  options: {
    capture: {
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
    },
    transcription: {
      modelPath,
    },
    insertion: {
      restoreClipboard: true,
    },
    autoInsert: true,
  },
});

console.log("Focus a text field. Recording for 5 seconds...");
await session.start();
await new Promise((resolve) => setTimeout(resolve, 5000));
const result = await session.stop();
console.log(result);
