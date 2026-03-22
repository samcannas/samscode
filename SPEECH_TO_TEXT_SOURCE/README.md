# desktop-stt-core

`desktop-stt-core` is a TypeScript desktop speech-to-text package for Node.js and Electron-style apps.

At a high level, it has three parts:

- input
- voice engine
- output

## Input

The input layer captures microphone audio and turns it into:

- live PCM chunks
- a final WAV file

Main files:

- `src/audio/naudiodon-capture.ts`
- `src/audio/wav-writer.ts`

Responsibilities:

- list input devices
- start and stop recording
- normalize audio to `16 kHz`, mono, `16-bit`
- write a WAV file for transcription

## Voice engine

The voice engine layer runs local speech-to-text using `whisper.cpp`.

Main files:

- `src/speech/whisper-process.ts`
- `src/speech/whisper-runtime.ts`
- `src/speech/local-whisper-transcriber.ts`
- `src/speech/vad-model-resolver.ts`

Responsibilities:

- resolve the local `whisper.cpp` CLI binary
- run it with a local model
- pass through options like language, prompt, threads, and VAD
- return normalized transcript text

## Output

The output layer pastes text into the currently focused desktop app.

Main files:

- `src/text/macos-text-inserter.ts`
- `src/text/windows-text-inserter.ts`
- `src/text/clipboard.ts`
- `src/text/nutjs-keystroke-driver.ts`

Responsibilities:

- save the clipboard
- write transcript text to the clipboard
- send the paste shortcut
- restore the clipboard

## Full flow

If you want all three layers wired together, use `DictationSession`.

Main file:

- `src/session/dictation-session.ts`

That flow is:

1. start recording
2. stop recording
3. transcribe the WAV file
4. optionally paste the result

## Where this runs

Use this package from:

- plain Node.js
- Electron main
- Electron preload with Node enabled

Do not use it directly in a browser-only or renderer-only environment.

## What a project needs to provide

There are two important runtime pieces:

### 1. Audio capture support

This package uses `naudiodon`, so the consuming project needs a desktop Node environment where native modules can run.

### 2. A local `whisper.cpp` binary

The package resolves the binary in this order:

1. `WHISPER_CPP_BIN`
2. `vendor/whisper/<platform-arch>/whisper-cli[.exe]`

You must provide a real `whisper-cli` binary for the platform you ship.

## Permissions

- macOS output automation requires Accessibility permission
- Windows output automation will not reliably work in elevated apps unless your app is also elevated

## Bundled resource

- `resources/vad/ggml-silero-v5.1.2.bin`

## How to use it in a TypeScript codebase

Yes, you can copy this TypeScript version into another project and build on top of it.

Typical pattern:

1. copy `boiled_down_ts` into your project
2. install its dependencies
3. provide a Whisper model path
4. provide a `whisper-cli` binary
5. use either:
   - `audio + speech` for local transcription only
   - `audio + speech + output` for dictation into desktop apps

## Example: full dictation

```ts
import {
  DictationSession,
  NaudiodonAudioCapture,
  LocalWhisperTranscriber,
  createPlatformTextInserter,
} from "./desktop-stt-core/src/index.js";

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
      modelPath: "C:/models/ggml-base.en.bin",
      language: "en",
      useVad: true,
    },
    insertion: {
      restoreClipboard: true,
    },
    autoInsert: true,
  },
});

await session.start();

const result = await session.stop();
console.log(result.text);
```

## Example: transcribe an existing WAV file

```ts
import { LocalWhisperTranscriber } from "./desktop-stt-core/src/index.js";

const transcriber = new LocalWhisperTranscriber();

const result = await transcriber.transcribeWav("C:/temp/input.wav", {
  modelPath: "C:/models/ggml-base.en.bin",
  language: "en",
  prompt: "Transcribe cleanly.",
  useVad: true,
});

console.log(result.text);
```

## Example: record audio only

```ts
import { NaudiodonAudioCapture } from "./desktop-stt-core/src/index.js";

const capture = new NaudiodonAudioCapture();

await capture.start({
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  output: {
    wavPath: "C:/temp/output.wav",
  },
});

capture.onChunk((chunk) => {
  console.log(chunk.timestampMs, chunk.pcm.length);
});

setTimeout(async () => {
  const result = await capture.stop();
  console.log(result);
}, 5000);
```

## What to tell another model or engineer

If you hand this folder to another model or engineer, the instruction is simple:

- use the input layer to capture audio
- use the voice engine to transcribe that WAV file locally
- use the output layer only if the project needs paste-into-app behavior

If a project only needs local speech-to-text, keep:

- `src/audio`
- `src/speech`

and ignore:

- `src/text`
