import type { DesktopUpdateState } from "@samscode/contracts";

export interface ResolvedDesktopUpdateMetadata {
  version: string;
  releaseName: string | null;
  releaseNotes: string | null;
  availableSizeBytes: number | null;
}

const HTML_ENTITY_REPLACEMENTS: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized in HTML_ENTITY_REPLACEMENTS) {
      return HTML_ENTITY_REPLACEMENTS[normalized] ?? match;
    }

    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function stripHtml(value: string): string {
  return value
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function sanitizeReleaseText(value: string): string | null {
  const stripped = stripHtml(decodeHtmlEntities(value));
  const normalized = stripped
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeReleaseText(value: string): string | null {
  return sanitizeReleaseText(value);
}

export function resolveDesktopUpdateReleaseNotes(releaseNotes: unknown): string | null {
  if (typeof releaseNotes === "string") {
    return normalizeReleaseText(releaseNotes);
  }

  if (!Array.isArray(releaseNotes)) {
    return null;
  }

  const parts = releaseNotes.flatMap((entry) => {
    if (typeof entry === "string") {
      const normalized = normalizeReleaseText(entry);
      return normalized ? [normalized] : [];
    }

    if (typeof entry !== "object" || entry === null) {
      return [];
    }

    const note = "note" in entry ? entry.note : null;
    if (typeof note !== "string") {
      return [];
    }

    const normalized = normalizeReleaseText(note);
    return normalized ? [normalized] : [];
  });

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}

export function resolveDesktopUpdateSizeBytes(files: unknown): number | null {
  if (!Array.isArray(files)) {
    return null;
  }

  const sizes = files.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || !("size" in entry)) {
      return [];
    }

    const size = entry.size;
    return typeof size === "number" && Number.isFinite(size) && size > 0 ? [size] : [];
  });

  if (sizes.length === 0) {
    return null;
  }

  return Math.max(...sizes);
}

export function resolveDesktopUpdateMetadata(info: {
  version: string;
  releaseName?: string | null;
  releaseNotes?: unknown;
  files?: unknown;
}): ResolvedDesktopUpdateMetadata {
  return {
    version: info.version,
    releaseName: normalizeReleaseText(info.releaseName ?? "") ?? null,
    releaseNotes: resolveDesktopUpdateReleaseNotes(info.releaseNotes),
    availableSizeBytes: resolveDesktopUpdateSizeBytes(info.files),
  };
}

export function shouldBroadcastDownloadProgress(
  currentState: DesktopUpdateState,
  nextPercent: number,
): boolean {
  if (currentState.status !== "downloading") {
    return true;
  }

  const currentPercent = currentState.downloadPercent;
  if (currentPercent === null) {
    return true;
  }

  const previousStep = Math.floor(currentPercent / 10);
  const nextStep = Math.floor(nextPercent / 10);
  return nextStep !== previousStep || nextPercent === 100;
}

export function nextStatusAfterDownloadFailure(
  currentState: DesktopUpdateState,
): DesktopUpdateState["status"] {
  return currentState.availableVersion ? "available" : "error";
}

export function getCanRetryAfterDownloadFailure(currentState: DesktopUpdateState): boolean {
  return currentState.availableVersion !== null;
}

export function getAutoUpdateDisabledReason(args: {
  isDevelopment: boolean;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appImage?: string | undefined;
  disabledByEnv: boolean;
}): string | null {
  if (args.isDevelopment || !args.isPackaged) {
    return "Automatic updates are only available in packaged production builds.";
  }
  if (args.disabledByEnv) {
    return "Automatic updates are disabled by the SAMSCODE_DISABLE_AUTO_UPDATE setting.";
  }
  if (args.platform === "linux" && !args.appImage) {
    return "Automatic updates on Linux require running the AppImage build.";
  }
  return null;
}
