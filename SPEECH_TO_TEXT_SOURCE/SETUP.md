# Setup

This package is not fully self-contained until you add:

1. a `whisper.cpp` CLI binary
2. a local Whisper model file

The TypeScript code is already in place. This file explains the remaining runtime setup.

## What you need

### 1. `whisper-cli`

You need a `whisper.cpp` command-line binary for the platform you are running on.

Official source:

- https://github.com/ggml-org/whisper.cpp

Typical ways to get it:

- download a release asset if one is available for your platform
- or build `whisper.cpp` yourself and take the generated `whisper-cli` binary

### 2. A Whisper model file

You also need a local model file such as:

- `ggml-tiny.en.bin`
- `ggml-base.en.bin`
- `ggml-small.en.bin`
- `ggml-medium.en.bin`
- `ggml-large-v3.bin`

Official model source:

- https://huggingface.co/ggerganov/whisper.cpp

Recommended starting point:

- `ggml-base.en.bin` for English-only general use

## Where to put `whisper-cli`

You have two options.

### Option A: use `WHISPER_CPP_BIN`

Set an environment variable that points directly to the binary.

Windows example:

```powershell
$env:WHISPER_CPP_BIN = "C:\tools\whisper.cpp\whisper-cli.exe"
```

macOS example:

```bash
export WHISPER_CPP_BIN="/Users/you/tools/whisper.cpp/whisper-cli"
```

### Option B: place it in the package vendor folder

Put the binary in one of these package paths:

- `vendor/whisper/win32-x64/whisper-cli.exe`
- `vendor/whisper/darwin-arm64/whisper-cli`
- `vendor/whisper/darwin-x64/whisper-cli`

The package resolves the binary in this order:

1. `WHISPER_CPP_BIN`
2. the matching `vendor/whisper/...` path

## Where to put the Whisper model

The model file can live anywhere on disk.

Examples:

- `C:\models\ggml-base.en.bin`
- `C:\Users\you\AppData\Local\MyApp\models\ggml-base.en.bin`
- `/Users/you/models/ggml-base.en.bin`

You pass this path into the TypeScript code as `modelPath`.

## Recommended folder layout

### Windows example

```text
your-project/
  desktop-stt-core/
    src/
    resources/
    vendor/
      whisper/
        win32-x64/
          whisper-cli.exe
  models/
    ggml-base.en.bin
```

Then use:

```ts
modelPath: "C:/path/to/your-project/models/ggml-base.en.bin"
```

### macOS Apple Silicon example

```text
your-project/
  desktop-stt-core/
    src/
    resources/
    vendor/
      whisper/
        darwin-arm64/
          whisper-cli
  models/
    ggml-base.en.bin
```

### macOS Intel example

```text
your-project/
  desktop-stt-core/
    src/
    resources/
    vendor/
      whisper/
        darwin-x64/
          whisper-cli
  models/
    ggml-base.en.bin
```

## Example usage after setup

```ts
import {
  DictationSession,
  NaudiodonAudioCapture,
  LocalWhisperTranscriber,
} from "./desktop-stt-core/src/index.js";

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
      modelPath: "C:/path/to/your-project/models/ggml-base.en.bin",
      language: "en",
      useVad: true,
    },
    autoInsert: false,
  },
});

await session.start();
const result = await session.stop();
console.log(result.text);
```

## Quick checklist

Before trying to run the package, confirm:

- `naudiodon` is installed successfully
- `whisper-cli` exists either in `WHISPER_CPP_BIN` or `vendor/whisper/...`
- your chosen Whisper model file exists
- your code passes a valid `modelPath`
- if you use paste automation:
  - macOS Accessibility permission is granted
  - Windows app is not elevated unless your app is also elevated

## Minimal practical recommendation

If you want the least confusing setup:

1. copy `boiled_down_ts` into your target project
2. place `whisper-cli` in the package `vendor/whisper/...` folder
3. create a top-level `models/` folder in your project
4. download `ggml-base.en.bin` into that folder
5. point `modelPath` at that file
