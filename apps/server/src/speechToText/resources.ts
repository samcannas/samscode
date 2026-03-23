import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

import type { SpeechToTextMutableState, SpeechToTextPaths } from "./types";

const VAD_RESOURCE_ID = "ggml-silero-v5.1.2.bin";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_VAD_MODEL_CANDIDATES = [
  path.resolve(MODULE_DIR, "../../resources/vad/ggml-silero-v5.1.2.bin"),
  path.resolve(MODULE_DIR, "../resources/vad/ggml-silero-v5.1.2.bin"),
  path.resolve(MODULE_DIR, "./resources/vad/ggml-silero-v5.1.2.bin"),
];

async function fileExists(candidatePath: string): Promise<boolean> {
  return (await fs.stat(candidatePath).catch(() => null))?.isFile() ?? false;
}

export async function ensureVadModelInstalled(input: {
  paths: SpeechToTextPaths;
  mutableState: SpeechToTextMutableState;
  publishState: () => Promise<unknown>;
}): Promise<string> {
  if (await fileExists(input.paths.vadModelPath)) {
    return input.paths.vadModelPath;
  }

  for (const candidatePath of BUNDLED_VAD_MODEL_CANDIDATES) {
    if (!(await fileExists(candidatePath))) {
      continue;
    }
    input.mutableState.activeDownload = {
      type: "resource",
      resourceId: VAD_RESOURCE_ID,
      phase: "completed",
      downloadedBytes: 0,
      totalBytes: null,
      message: "Using bundled voice activity detector",
    };
    await input.publishState();
    input.mutableState.activeDownload = null;
    await input.publishState();
    return candidatePath;
  }

  throw new Error(
    `Bundled voice activity detector not found. Checked: ${BUNDLED_VAD_MODEL_CANDIDATES.join(", ")}`,
  );
}
