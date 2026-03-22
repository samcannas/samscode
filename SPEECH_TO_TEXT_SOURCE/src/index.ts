export * from "./common/errors.js";
export * from "./audio/audio-capture.js";
export * from "./audio/audio-device.js";
export * from "./audio/capture-types.js";
export * from "./audio/wav-writer.js";
export * from "./audio/naudiodon-capture.js";
export * from "./speech/speech-transcriber.js";
export * from "./speech/whisper-types.js";
export * from "./speech/whisper-runtime.js";
export * from "./speech/whisper-process.js";
export * from "./speech/local-whisper-transcriber.js";
export * from "./speech/vad-model-resolver.js";
export * from "./text/text-inserter.js";
export * from "./text/macos-text-inserter.js";
export * from "./text/windows-text-inserter.js";
export * from "./text/nutjs-keystroke-driver.js";
export * from "./session/dictation-types.js";
export * from "./session/dictation-session.js";

import type { TextInserter } from "./text/text-inserter.js";
import { MacosTextInserter } from "./text/macos-text-inserter.js";
import { WindowsTextInserter } from "./text/windows-text-inserter.js";
import { InsertionError } from "./common/errors.js";

export function createPlatformTextInserter(): TextInserter {
  if (process.platform === "darwin") {
    return new MacosTextInserter();
  }
  if (process.platform === "win32") {
    return new WindowsTextInserter();
  }
  throw new InsertionError(`Unsupported platform for text insertion: ${process.platform}`);
}
