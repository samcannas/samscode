import path from "node:path";
import { fileExists, resolvePackageRoot } from "../common/fs.js";
import { ModelLoadError, DependencyError } from "../common/errors.js";
import { getPlatformKey } from "../common/platform.js";
import type { WhisperTranscribeOptions } from "./whisper-types.js";

export function getVendorBinaryName(): string {
  return process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

export async function resolveWhisperBinaryPath(): Promise<string> {
  const envPath = process.env.WHISPER_CPP_BIN;
  if (envPath) {
    if (!(await fileExists(envPath))) {
      throw new DependencyError(`WHISPER_CPP_BIN points to a missing file: ${envPath}`);
    }
    return envPath;
  }

  const vendorPath = path.join(resolvePackageRoot(), "vendor", "whisper", getPlatformKey(), getVendorBinaryName());
  if (!(await fileExists(vendorPath))) {
    throw new DependencyError(
      `whisper.cpp binary not found. Set WHISPER_CPP_BIN or place a binary at ${vendorPath}`
    );
  }

  return vendorPath;
}

export async function assertWhisperInputs(audioPath: string, options: WhisperTranscribeOptions): Promise<void> {
  if (!(await fileExists(audioPath))) {
    throw new ModelLoadError(`Audio file not found: ${audioPath}`);
  }
  if (!(await fileExists(options.modelPath))) {
    throw new ModelLoadError(`Whisper model not found: ${options.modelPath}`);
  }
}

export function buildWhisperCliArgs(
  audioPath: string,
  outputBasePath: string,
  options: WhisperTranscribeOptions
): string[] {
  const args = [
    "-m",
    options.modelPath,
    "-f",
    audioPath,
    "--output-json",
    "--output-file",
    outputBasePath,
    "--no-prints",
    "--temperature",
    String(options.temperature ?? 0.2),
  ];

  if (options.language && options.language !== "auto") {
    args.push("--language", options.language);
  }

  if (options.prompt) {
    args.push("--prompt", options.prompt);
  }

  if (options.threads && options.threads > 0) {
    args.push("--threads", String(options.threads));
  }

  if (options.useVad && options.vadModelPath) {
    args.push("--vad", "--vad-model", options.vadModelPath);
  }

  return args;
}
