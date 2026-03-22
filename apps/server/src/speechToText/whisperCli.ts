import { promises as fs } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";

import { runProcess } from "../processRunner";

interface WhisperJsonSegment {
  readonly text?: string;
}

interface WhisperJsonOutput {
  readonly text?: string;
  readonly transcription?: ReadonlyArray<WhisperJsonSegment>;
}

export function buildWhisperCliArgs(input: {
  modelPath: string;
  audioPath: string;
  outputBasePath: string;
}): string[] {
  const threads = Math.max(1, Math.min(os.availableParallelism?.() ?? 2, 8));
  return [
    "-m",
    input.modelPath,
    "-f",
    input.audioPath,
    "--output-json",
    "--output-file",
    input.outputBasePath,
    "--no-prints",
    "--threads",
    String(threads),
  ];
}

function parseTranscriptFromStdout(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("[") && !line.startsWith("whisper_"))
    .join(" ")
    .trim();
}

export function parseTranscriptFromWhisperJson(parsed: WhisperJsonOutput): string {
  if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
    return parsed.text.trim();
  }

  if (!Array.isArray(parsed.transcription)) {
    return "";
  }

  return parsed.transcription
    .map((segment) => (typeof segment.text === "string" ? segment.text.trim() : ""))
    .filter((segment) => segment.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function transcribeWithWhisperCli(input: {
  binaryPath: string;
  modelPath: string;
  audioPath: string;
  outputBasePath: string;
}): Promise<{ text: string; elapsedMs: number }> {
  const args = buildWhisperCliArgs(input);
  const startedAt = performance.now();
  const result = await runProcess(input.binaryPath, args, {
    timeoutMs: 10 * 60_000,
    allowNonZeroExit: true,
    outputMode: "truncate",
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "Unknown whisper.cpp failure.";
    throw new Error(`whisper.cpp failed: ${detail}`);
  }

  const outputJsonPath = `${input.outputBasePath}.json`;
  let text = "";
  try {
    const raw = await fs.readFile(outputJsonPath, "utf8");
    const parsed = JSON.parse(raw) as WhisperJsonOutput;
    text = parseTranscriptFromWhisperJson(parsed);
  } catch {
    text = parseTranscriptFromStdout(result.stdout);
  }

  if (!text) {
    throw new Error("whisper.cpp completed without returning transcript text.");
  }

  return { text, elapsedMs };
}
