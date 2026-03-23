import { describe, expect, it } from "vitest";

import { buildWhisperCliArgs, parseTranscriptFromWhisperJson } from "./whisperCli";

describe("speechToText whisperCli", () => {
  it("builds whisper-cli arguments for wav transcription", () => {
    expect(
      buildWhisperCliArgs({
        modelPath: "/models/ggml-base.en.bin",
        audioPath: "/tmp/input.wav",
        outputBasePath: "/tmp/output",
        language: "en",
        prompt: "Prompt",
        useVad: true,
        vadModelPath: "/models/ggml-silero-v5.1.2.bin",
      }),
    ).toEqual(
      expect.arrayContaining([
        "-m",
        "/models/ggml-base.en.bin",
        "-f",
        "/tmp/input.wav",
        "--output-json",
        "--output-file",
        "/tmp/output",
        "--no-prints",
        "--language",
        "en",
        "--prompt",
        "Prompt",
        "--vad",
      ]),
    );
  });

  it("parses transcript text from whisper.cpp json output", () => {
    expect(
      parseTranscriptFromWhisperJson({
        transcription: [{ text: " hello" }, { text: "world " }],
      }),
    ).toBe("hello world");
  });

  it("supports legacy top-level text output", () => {
    expect(
      parseTranscriptFromWhisperJson({
        text: "  hello there  ",
      }),
    ).toBe("hello there");
  });
});
