import { promises as fs } from "node:fs";
import path from "node:path";

import { writePcmChunksToWavFile } from "./pcmWav";
import { transcribeWithWhisperCli } from "./whisperCli";

export async function runSpeechToTextWarmup(input: {
  binaryPath: string;
  modelPath: string;
  tmpDir: string;
  language: string;
  prompt: string;
  useVad: boolean;
  vadModelPath: string | undefined;
}): Promise<void> {
  const tempPrefix = `warmup-${Date.now()}`;
  const wavPath = path.join(input.tmpDir, `${tempPrefix}.wav`);
  const outputBasePath = path.join(input.tmpDir, `${tempPrefix}-output`);
  const silenceChunk = Buffer.alloc(16_000 * 2);

  try {
    await writePcmChunksToWavFile(wavPath, [silenceChunk]);
    await transcribeWithWhisperCli({
      binaryPath: input.binaryPath,
      modelPath: input.modelPath,
      audioPath: wavPath,
      outputBasePath,
      language: input.language,
      prompt: input.prompt,
      useVad: input.useVad,
      vadModelPath: input.vadModelPath,
      allowEmptyText: true,
    });
  } catch {
    // Warmup is best-effort only.
  } finally {
    await Promise.all([
      fs.rm(wavPath, { force: true }).catch(() => undefined),
      fs.rm(`${outputBasePath}.json`, { force: true }).catch(() => undefined),
      fs.rm(`${outputBasePath}.txt`, { force: true }).catch(() => undefined),
      fs.rm(`${outputBasePath}.srt`, { force: true }).catch(() => undefined),
      fs.rm(`${outputBasePath}.vtt`, { force: true }).catch(() => undefined),
    ]);
  }
}
