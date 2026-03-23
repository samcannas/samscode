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

export interface WhisperCliInvocation {
  readonly binaryPath: string;
  readonly modelPath: string;
  readonly audioPath: string;
  readonly outputBasePath: string;
  readonly language: string;
  readonly prompt: string;
  readonly useVad: boolean;
  readonly vadModelPath: string | undefined;
  readonly temperature?: number;
  readonly threads?: number;
  readonly allowEmptyText?: boolean;
}

function getDefaultThreads(): number {
  const available = os.availableParallelism?.() ?? 4;
  return Math.max(1, Math.min(available > 2 ? available - 1 : available, 8));
}

export function buildWhisperCliArgs(input: {
  modelPath: string;
  audioPath: string;
  outputBasePath: string;
  language: string;
  prompt: string;
  useVad: boolean;
  vadModelPath: string | undefined;
  temperature?: number;
  threads?: number;
}): string[] {
  const args = [
    "-m",
    input.modelPath,
    "-f",
    input.audioPath,
    "--output-json",
    "--output-file",
    input.outputBasePath,
    "--no-prints",
    "--temperature",
    String(input.temperature ?? 0.2),
    "--threads",
    String(input.threads ?? getDefaultThreads()),
  ];

  if (input.language && input.language !== "auto") {
    args.push("--language", input.language);
  }

  if (input.prompt.trim().length > 0) {
    args.push("--prompt", input.prompt.trim());
  }

  if (input.useVad && input.vadModelPath) {
    args.push("--vad", "--vad-model", input.vadModelPath);
  }

  return args;
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

export async function transcribeWithWhisperCli(
  input: WhisperCliInvocation,
): Promise<{ text: string; elapsedMs: number }> {
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

  if (!text && !input.allowEmptyText) {
    throw new Error("whisper.cpp completed without returning transcript text.");
  }

  return { text, elapsedMs };
}
