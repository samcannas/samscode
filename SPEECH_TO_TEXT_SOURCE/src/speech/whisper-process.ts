import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import { createTempFilePath, fileExists } from "../common/fs.js";
import { runCommand } from "../common/child-process.js";
import { TranscriptionError } from "../common/errors.js";
import type { SpeechTranscriber } from "./speech-transcriber.js";
import type { TranscriptionResult, WhisperTranscribeOptions } from "./whisper-types.js";
import { assertWhisperInputs, buildWhisperCliArgs, resolveWhisperBinaryPath } from "./whisper-runtime.js";
import { VadModelResolver } from "./vad-model-resolver.js";

function parseTranscriptFromStdout(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("[") && !line.startsWith("whisper_"))
    .join(" ")
    .trim();
}

export class WhisperProcessTranscriber implements SpeechTranscriber {
  constructor(private readonly vadResolver = new VadModelResolver()) {}

  async transcribeWav(audioPath: string, options: WhisperTranscribeOptions): Promise<TranscriptionResult> {
    await assertWhisperInputs(audioPath, options);

    const effectiveOptions = { ...options };
    if (effectiveOptions.useVad) {
      effectiveOptions.vadModelPath = await this.vadResolver.resolve(effectiveOptions.vadModelPath);
    }

    const binaryPath = await resolveWhisperBinaryPath();
    const outputBase = await createTempFilePath("whisper-output", "");
    const args = buildWhisperCliArgs(audioPath, outputBase, effectiveOptions);

    const startedAt = performance.now();
    const result = await runCommand(binaryPath, args);
    const elapsedMs = performance.now() - startedAt;

    if (result.exitCode !== 0) {
      throw new TranscriptionError(`whisper.cpp exited with code ${result.exitCode}: ${result.stderr.trim()}`);
    }

    const outputJsonPath = `${outputBase}.json`;
    let text = "";

    if (await fileExists(outputJsonPath)) {
      const raw = await fs.readFile(outputJsonPath, "utf8");
      const parsed = JSON.parse(raw) as { text?: string };
      text = parsed.text?.trim() ?? "";
    } else {
      text = parseTranscriptFromStdout(result.stdout);
    }

    if (!text) {
      throw new TranscriptionError("whisper.cpp completed without returning any transcript text");
    }

    return {
      text,
      elapsedMs,
      engine: "whisper.cpp",
    };
  }
}
