import type { DesktopRuntimeInfo, DesktopUpdateState } from "@samscode/contracts";

import { getCanRetryAfterDownloadFailure, nextStatusAfterDownloadFailure } from "./updateState";

interface DesktopUpdateMetadataInput {
  version: string;
  releaseName: string | null;
  releaseNotes: string | null;
  availableSizeBytes: number | null;
}

interface PendingInstallHintInput extends DesktopUpdateMetadataInput {
  downloadedAt: string;
}

export function createInitialDesktopUpdateState(
  currentVersion: string,
  runtimeInfo: DesktopRuntimeInfo,
): DesktopUpdateState {
  return {
    enabled: false,
    status: "disabled",
    currentVersion,
    hostArch: runtimeInfo.hostArch,
    appArch: runtimeInfo.appArch,
    runningUnderArm64Translation: runtimeInfo.runningUnderArm64Translation,
    availableVersion: null,
    downloadedVersion: null,
    pendingInstallVersion: null,
    releaseName: null,
    releaseNotes: null,
    availableSizeBytes: null,
    downloadPercent: null,
    checkedAt: null,
    downloadedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnPendingInstallHintRestored(
  state: DesktopUpdateState,
  hint: PendingInstallHintInput,
): DesktopUpdateState {
  return {
    ...state,
    pendingInstallVersion: hint.version,
    releaseName: hint.releaseName,
    releaseNotes: hint.releaseNotes,
    availableSizeBytes: hint.availableSizeBytes,
    downloadedAt: hint.downloadedAt,
  };
}

export function reduceDesktopUpdateStateOnCheckStart(
  state: DesktopUpdateState,
  checkedAt: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "checking",
    checkedAt,
    message: null,
    downloadPercent: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnCheckFailure(
  state: DesktopUpdateState,
  message: string,
  checkedAt: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "error",
    message,
    checkedAt,
    downloadPercent: null,
    errorContext: "check",
    canRetry: true,
  };
}

export function reduceDesktopUpdateStateOnUpdateAvailable(
  state: DesktopUpdateState,
  metadata: DesktopUpdateMetadataInput,
  checkedAt: string,
): DesktopUpdateState {
  const pendingInstallVersion =
    state.pendingInstallVersion === metadata.version ? state.pendingInstallVersion : null;

  return {
    ...state,
    status: "available",
    availableVersion: metadata.version,
    downloadedVersion: null,
    pendingInstallVersion,
    releaseName: metadata.releaseName,
    releaseNotes: metadata.releaseNotes,
    availableSizeBytes: metadata.availableSizeBytes,
    downloadPercent: null,
    checkedAt,
    downloadedAt: pendingInstallVersion ? state.downloadedAt : null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnNoUpdate(
  state: DesktopUpdateState,
  checkedAt: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "up-to-date",
    availableVersion: null,
    downloadedVersion: null,
    pendingInstallVersion: null,
    releaseName: null,
    releaseNotes: null,
    availableSizeBytes: null,
    downloadPercent: null,
    checkedAt,
    downloadedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnDownloadStart(
  state: DesktopUpdateState,
): DesktopUpdateState {
  return {
    ...state,
    status: "downloading",
    downloadPercent: 0,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnDownloadFailure(
  state: DesktopUpdateState,
  message: string,
): DesktopUpdateState {
  return {
    ...state,
    status: nextStatusAfterDownloadFailure(state),
    message,
    downloadPercent: null,
    errorContext: "download",
    canRetry: getCanRetryAfterDownloadFailure(state),
  };
}

export function reduceDesktopUpdateStateOnDownloadProgress(
  state: DesktopUpdateState,
  percent: number,
): DesktopUpdateState {
  return {
    ...state,
    status: "downloading",
    downloadPercent: percent,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnDownloadComplete(
  state: DesktopUpdateState,
  metadata: DesktopUpdateMetadataInput,
  downloadedAt: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "downloaded",
    availableVersion: metadata.version,
    downloadedVersion: metadata.version,
    pendingInstallVersion: metadata.version,
    releaseName: metadata.releaseName,
    releaseNotes: metadata.releaseNotes,
    availableSizeBytes: metadata.availableSizeBytes,
    downloadPercent: 100,
    downloadedAt,
    message: null,
    errorContext: null,
    canRetry: true,
  };
}

export function reduceDesktopUpdateStateOnInstallFailure(
  state: DesktopUpdateState,
  message: string,
): DesktopUpdateState {
  return {
    ...state,
    status: "downloaded",
    message,
    errorContext: "install",
    canRetry: true,
  };
}
