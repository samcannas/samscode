import * as FS from "node:fs";
import * as Path from "node:path";

export interface PersistedDesktopUpdateHint {
  version: string;
  releaseName: string | null;
  releaseNotes: string | null;
  availableSizeBytes: number | null;
  downloadedAt: string;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

export function readPersistedDesktopUpdateHint(
  filePath: string,
): PersistedDesktopUpdateHint | null {
  if (!FS.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = FS.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const version = normalizeString(parsed.version);
    const downloadedAt = normalizeString(parsed.downloadedAt);
    if (!version || !downloadedAt) {
      return null;
    }

    return {
      version,
      releaseName: normalizeString(parsed.releaseName),
      releaseNotes: normalizeString(parsed.releaseNotes),
      availableSizeBytes: normalizeOptionalNumber(parsed.availableSizeBytes),
      downloadedAt,
    };
  } catch {
    return null;
  }
}

export function writePersistedDesktopUpdateHint(
  filePath: string,
  hint: PersistedDesktopUpdateHint,
): void {
  FS.mkdirSync(Path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  FS.writeFileSync(tempPath, `${JSON.stringify(hint, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, filePath);
}

export function clearPersistedDesktopUpdateHint(filePath: string): void {
  try {
    FS.rmSync(filePath, { force: true });
  } catch {
    // Ignore persistence cleanup failures.
  }
}
