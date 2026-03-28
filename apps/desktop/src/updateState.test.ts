import { describe, expect, it } from "vitest";
import type { DesktopUpdateState } from "@samscode/contracts";

import {
  getCanRetryAfterDownloadFailure,
  getAutoUpdateDisabledReason,
  nextStatusAfterDownloadFailure,
  resolveDesktopUpdateMetadata,
  resolveDesktopUpdateReleaseNotes,
  resolveDesktopUpdateSizeBytes,
  shouldBroadcastDownloadProgress,
} from "./updateState";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
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

describe("shouldBroadcastDownloadProgress", () => {
  it("broadcasts the first downloading progress update", () => {
    expect(
      shouldBroadcastDownloadProgress(
        { ...baseState, status: "downloading", downloadPercent: null },
        1,
      ),
    ).toBe(true);
  });

  it("skips progress updates within the same 10% bucket", () => {
    expect(
      shouldBroadcastDownloadProgress(
        { ...baseState, status: "downloading", downloadPercent: 11.2 },
        18.7,
      ),
    ).toBe(false);
  });

  it("broadcasts progress updates when a new 10% bucket is reached", () => {
    expect(
      shouldBroadcastDownloadProgress(
        { ...baseState, status: "downloading", downloadPercent: 19.9 },
        20.1,
      ),
    ).toBe(true);
  });

  it("broadcasts progress updates when a retry resets the download percentage", () => {
    expect(
      shouldBroadcastDownloadProgress(
        { ...baseState, status: "downloading", downloadPercent: 50.4 },
        0.2,
      ),
    ).toBe(true);
  });
});

describe("getAutoUpdateDisabledReason", () => {
  it("reports development builds as disabled", () => {
    expect(
      getAutoUpdateDisabledReason({
        isDevelopment: true,
        isPackaged: false,
        platform: "darwin",
        appImage: undefined,
        disabledByEnv: false,
      }),
    ).toContain("packaged production builds");
  });

  it("reports env-disabled auto updates", () => {
    expect(
      getAutoUpdateDisabledReason({
        isDevelopment: false,
        isPackaged: true,
        platform: "darwin",
        appImage: undefined,
        disabledByEnv: true,
      }),
    ).toContain("SAMSCODE_DISABLE_AUTO_UPDATE");
  });

  it("reports linux non-AppImage builds as disabled", () => {
    expect(
      getAutoUpdateDisabledReason({
        isDevelopment: false,
        isPackaged: true,
        platform: "linux",
        appImage: undefined,
        disabledByEnv: false,
      }),
    ).toContain("AppImage");
  });
});

describe("desktop update metadata helpers", () => {
  it("extracts release notes from structured changelog arrays", () => {
    expect(
      resolveDesktopUpdateReleaseNotes([{ note: "First note" }, { note: "Second note" }]),
    ).toBe("First note\n\nSecond note");
  });

  it("strips html and decodes entities from GitHub release notes", () => {
    expect(
      resolveDesktopUpdateReleaseNotes(
        '<p><strong>Full Changelog:</strong> <a href="https://github.com/samcannas/samscode/compare/v0.1.2...v0.1.3">v0.1.2...v0.1.3</a> &amp; more</p>',
      ),
    ).toBe("Full Changelog: v0.1.2...v0.1.3 & more");
  });

  it("uses the largest file size as an approximate download size", () => {
    expect(resolveDesktopUpdateSizeBytes([{ size: 12 }, { size: 42 }])).toBe(42);
  });

  it("normalizes update metadata from updater payloads", () => {
    expect(
      resolveDesktopUpdateMetadata({
        version: "1.1.0",
        releaseName: " Sam's Code 1.1.0 ",
        releaseNotes: " Adds update prompts ",
        files: [{ size: 2048 }],
      }),
    ).toEqual({
      version: "1.1.0",
      releaseName: "Sam's Code 1.1.0",
      releaseNotes: "Adds update prompts",
      availableSizeBytes: 2048,
    });
  });
});

describe("nextStatusAfterDownloadFailure", () => {
  it("returns available when an update version is still known", () => {
    expect(
      nextStatusAfterDownloadFailure({
        ...baseState,
        status: "downloading",
        availableVersion: "1.1.0",
      }),
    ).toBe("available");
  });

  it("returns error when no update version can be retried", () => {
    expect(
      nextStatusAfterDownloadFailure({
        ...baseState,
        status: "downloading",
        availableVersion: null,
      }),
    ).toBe("error");
  });
});

describe("getCanRetryAfterDownloadFailure", () => {
  it("returns true when an available version is still present", () => {
    expect(
      getCanRetryAfterDownloadFailure({
        ...baseState,
        status: "downloading",
        availableVersion: "1.1.0",
      }),
    ).toBe(true);
  });

  it("returns false when no version is available to retry", () => {
    expect(
      getCanRetryAfterDownloadFailure({
        ...baseState,
        status: "downloading",
        availableVersion: null,
      }),
    ).toBe(false);
  });
});
