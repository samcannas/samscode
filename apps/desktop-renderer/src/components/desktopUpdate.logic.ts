import type { DesktopUpdateActionResult, DesktopUpdateState } from "@samscode/contracts";

export type DesktopUpdateButtonAction = "download" | "install" | "none";
export type DesktopUpdatePromptKind = "available" | "downloading" | "install" | "verifying";

export function formatDesktopUpdateByteSize(sizeBytes: number | null): string | null {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return null;
  }

  if (sizeBytes >= 1024 * 1024 * 1024) {
    return `~${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  return `~${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getDesktopUpdateVersion(state: DesktopUpdateState | null): string | null {
  if (!state) return null;
  return state.downloadedVersion ?? state.availableVersion ?? state.pendingInstallVersion;
}

export function getDesktopUpdateReleaseNotesSnippet(
  state: DesktopUpdateState | null,
  maxLength = 220,
): string | null {
  const notes = state?.releaseNotes?.replace(/\s+/g, " ").trim() ?? "";
  if (notes.length === 0) {
    return null;
  }

  if (notes.length <= maxLength) {
    return notes;
  }

  return `${notes.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

export function resolveDesktopUpdatePromptKind(
  state: DesktopUpdateState | null,
): DesktopUpdatePromptKind | null {
  if (!state || !state.enabled) {
    return null;
  }

  if (state.status === "downloaded") {
    return "install";
  }

  if (state.status === "downloading") {
    return "downloading";
  }

  if (
    state.pendingInstallVersion &&
    state.downloadedVersion === null &&
    (state.status === "idle" || state.status === "checking")
  ) {
    return "verifying";
  }

  if (state.status === "available") {
    return "available";
  }

  return null;
}

export function getDesktopUpdateStatusSummary(state: DesktopUpdateState | null): string {
  if (!state) {
    return "Desktop update status unavailable.";
  }

  const version = getDesktopUpdateVersion(state);
  const size = formatDesktopUpdateByteSize(state.availableSizeBytes);

  if (!state.enabled) {
    return state.message ?? "Automatic updates are unavailable in this build.";
  }

  if (state.message && state.errorContext === "download" && state.availableVersion) {
    return `Download failed for ${state.availableVersion}: ${state.message}`;
  }

  if (state.message && state.errorContext === "install" && state.downloadedVersion) {
    return `Install failed for ${state.downloadedVersion}: ${state.message}`;
  }

  switch (state.status) {
    case "disabled":
      return state.message ?? "Automatic updates are unavailable in this build.";
    case "idle":
      return state.pendingInstallVersion
        ? `Verifying previously downloaded update ${state.pendingInstallVersion}.`
        : "Automatic updates are enabled.";
    case "checking":
      return state.pendingInstallVersion
        ? `Verifying the downloaded ${state.pendingInstallVersion} installer from a previous session.`
        : "Checking for updates...";
    case "up-to-date":
      return `Sam's Code ${state.currentVersion} is up to date.`;
    case "available":
      return `Version ${version ?? "available"} is ready to download${size ? ` (${size})` : ""}.`;
    case "downloading": {
      const progress =
        typeof state.downloadPercent === "number" ? `${Math.floor(state.downloadPercent)}%` : null;
      return `Downloading ${version ?? "update"}${progress ? ` (${progress})` : ""}${size ? ` of ${size}` : ""}.`;
    }
    case "downloaded":
      return `Version ${version ?? "ready"} has been downloaded and is ready to install.`;
    case "error":
      return state.message ?? "Automatic updates failed.";
  }
}

export function getDesktopUpdateSettingsDescription(state: DesktopUpdateState | null): string {
  if (!state) {
    return "Connect to the desktop bridge to inspect update availability.";
  }

  if (!state.enabled) {
    return state.message ?? "Automatic updates are unavailable in this environment.";
  }

  if (state.message && state.errorContext === "download") {
    return "Retry the download or check again later.";
  }

  if (state.message && state.errorContext === "install") {
    return "The downloaded update is still cached. Install again whenever you're ready.";
  }

  if (state.status === "downloaded" && state.downloadedAt) {
    return `Downloaded ${new Date(state.downloadedAt).toLocaleString()}. Install now or reopen the app later to be prompted again.`;
  }

  if (state.status === "up-to-date" && state.checkedAt) {
    return `Last checked ${new Date(state.checkedAt).toLocaleString()}.`;
  }

  if (state.checkedAt) {
    return `Last checked ${new Date(state.checkedAt).toLocaleString()}.`;
  }

  return "Use the actions below to check for, download, and install updates.";
}

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "downloaded") {
    return "install";
  }
  if (state.status === "error") {
    if (state.errorContext === "install" && state.downloadedVersion) {
      return "install";
    }
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.status === "downloading") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading";
}

export function getArm64IntelBuildWarningDescription(state: DesktopUpdateState): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return "This install is using the correct architecture.";
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return "This Mac has Apple Silicon, but Sam's Code is still running the Intel build under Rosetta. Download the available update to switch to the native Apple Silicon build.";
  }
  if (action === "install") {
    return "This Mac has Apple Silicon, but Sam's Code is still running the Intel build under Rosetta. Restart to install the downloaded Apple Silicon build.";
  }
  return "This Mac has Apple Silicon, but Sam's Code is still running the Intel build under Rosetta. The next app update will replace it with the native Apple Silicon build.";
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.errorContext === "download" && state.availableVersion) {
    return `Download failed for ${state.availableVersion}. Click to retry.`;
  }
  if (state.errorContext === "install" && state.downloadedVersion) {
    return `Install failed for ${state.downloadedVersion}. Click to retry.`;
  }
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} ready to download`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} downloaded. Click to restart and install.`;
  }
  if (state.status === "error") {
    return state.message ?? "Update failed";
  }
  return "Update available";
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return result.accepted && !result.completed;
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || !state.message) return false;
  return state.errorContext === "download" || state.errorContext === "install";
}
