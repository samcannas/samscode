import { describe, expect, it } from "vitest";
import { buildWhisperCliArgs } from "../src/speech/whisper-runtime.js";

describe("buildWhisperCliArgs", () => {
  it("omits explicit language for auto", () => {
    const args = buildWhisperCliArgs("audio.wav", "out", {
      modelPath: "model.bin",
      language: "auto",
    });

    expect(args).not.toContain("--language");
  });

  it("adds prompt, language, threads and vad", () => {
    const args = buildWhisperCliArgs("audio.wav", "out", {
      modelPath: "model.bin",
      language: "en",
      prompt: "hello",
      threads: 4,
      useVad: true,
      vadModelPath: "vad.bin",
    });

    expect(args).toContain("--language");
    expect(args).toContain("en");
    expect(args).toContain("--prompt");
    expect(args).toContain("hello");
    expect(args).toContain("--threads");
    expect(args).toContain("4");
    expect(args).toContain("--vad-model");
    expect(args).toContain("vad.bin");
  });
});
