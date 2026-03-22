import path from "node:path";
import { fileExists, resolvePackageRoot } from "../common/fs.js";
import { ModelLoadError } from "../common/errors.js";

export class VadModelResolver {
  async resolve(explicitPath?: string): Promise<string> {
    if (explicitPath) {
      if (!(await fileExists(explicitPath))) {
        throw new ModelLoadError(`VAD model not found: ${explicitPath}`);
      }
      return explicitPath;
    }

    const defaultPath = path.join(resolvePackageRoot(), "resources", "vad", "ggml-silero-v5.1.2.bin");
    if (!(await fileExists(defaultPath))) {
      throw new ModelLoadError(`Bundled VAD model not found: ${defaultPath}`);
    }
    return defaultPath;
  }
}
