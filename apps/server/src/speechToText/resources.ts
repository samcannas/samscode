import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

import type { SpeechToTextPaths } from "./types";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_VAD_MODEL_CANDIDATES = [
  path.resolve(MODULE_DIR, "../../resources/vad/ggml-silero-v5.1.2.bin"),
  path.resolve(MODULE_DIR, "../resources/vad/ggml-silero-v5.1.2.bin"),
  path.resolve(MODULE_DIR, "./resources/vad/ggml-silero-v5.1.2.bin"),
];
const BUNDLED_PYTHON_STT_SERVER_CANDIDATES = [
  path.resolve(MODULE_DIR, "../../resources/stt/python_stt_server.py"),
  path.resolve(MODULE_DIR, "../resources/stt/python_stt_server.py"),
  path.resolve(MODULE_DIR, "./resources/stt/python_stt_server.py"),
];

async function fileExists(candidatePath: string): Promise<boolean> {
  return (await fs.stat(candidatePath).catch(() => null))?.isFile() ?? false;
}

export async function ensureVadModelInstalled(input: {
  paths: SpeechToTextPaths;
}): Promise<string> {
  if (await fileExists(input.paths.vadModelPath)) {
    return input.paths.vadModelPath;
  }

  for (const candidatePath of BUNDLED_VAD_MODEL_CANDIDATES) {
    if (!(await fileExists(candidatePath))) {
      continue;
    }
    await fs.mkdir(path.dirname(input.paths.vadModelPath), { recursive: true });
    await fs.copyFile(candidatePath, input.paths.vadModelPath);
    return input.paths.vadModelPath;
  }

  throw new Error(
    `Bundled voice activity detector not found. Checked: ${BUNDLED_VAD_MODEL_CANDIDATES.join(", ")}`,
  );
}

export async function resolveBundledPythonSidecarScript(): Promise<string> {
  for (const candidatePath of BUNDLED_PYTHON_STT_SERVER_CANDIDATES) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(
    `Bundled Python STT sidecar script not found. Checked: ${BUNDLED_PYTHON_STT_SERVER_CANDIDATES.join(", ")}`,
  );
}
