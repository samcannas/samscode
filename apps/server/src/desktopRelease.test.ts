import { describe, expect, it } from "vitest";

import {
  pickDesktopReleaseAsset,
  renderDesktopReleaseSummary,
  resolveDesktopInstallTarget,
  resolveGitHubRepositorySlug,
} from "./desktopRelease";

describe("desktop release helpers", () => {
  it("extracts the GitHub owner and repo from repository URLs", () => {
    expect(resolveGitHubRepositorySlug("https://github.com/samcannas/samscode")).toEqual({
      owner: "samcannas",
      repo: "samscode",
    });
    expect(resolveGitHubRepositorySlug("https://github.com/samcannas/samscode.git")).toEqual({
      owner: "samcannas",
      repo: "samscode",
    });
    expect(resolveGitHubRepositorySlug("https://example.com/samcannas/samscode")).toBeNull();
  });

  it("prefers the Apple Silicon dmg when running on macOS arm64", () => {
    const target = resolveDesktopInstallTarget("darwin", "arm64");
    const asset = pickDesktopReleaseAsset(
      [
        {
          name: "samscode-0.0.13-x64.dmg",
          browser_download_url: "https://example.com/x64.dmg",
        },
        {
          name: "samscode-0.0.13-arm64.dmg",
          browser_download_url: "https://example.com/arm64.dmg",
        },
      ],
      target,
    );

    expect(target.platformLabel).toBe("macOS (Apple Silicon)");
    expect(asset?.browser_download_url).toBe("https://example.com/arm64.dmg");
  });

  it("chooses the Windows installer when running on Windows", () => {
    const target = resolveDesktopInstallTarget("win32", "x64");
    const asset = pickDesktopReleaseAsset(
      [
        {
          name: "samscode-0.0.13-x64.blockmap",
          browser_download_url: "https://example.com/latest.blockmap",
        },
        {
          name: "samscode-0.0.13-x64.exe",
          browser_download_url: "https://example.com/latest.exe",
        },
      ],
      target,
    );

    expect(target.assetLabel).toBe("Windows installer (.exe)");
    expect(asset?.browser_download_url).toBe("https://example.com/latest.exe");
  });

  it("renders the latest release page above the direct download link", () => {
    const summary = renderDesktopReleaseSummary({
      currentVersion: "0.0.13",
      platformLabel: "Windows",
      releasesPageUrl: "https://github.com/samcannas/samscode/releases",
      latestReleaseTag: "v0.0.13",
      latestReleaseUrl: "https://github.com/samcannas/samscode/releases/tag/v0.0.13",
      directDownloadLabel: "Windows installer (.exe)",
      directDownloadUrl:
        "https://github.com/samcannas/samscode/releases/download/v0.0.13/samscode.exe",
    });

    expect(summary).toContain("Sam's Code CLI 0.0.13");
    expect(summary).toContain(
      "Release page: https://github.com/samcannas/samscode/releases/tag/v0.0.13",
    );
    expect(summary).toContain(
      "Windows installer (.exe): https://github.com/samcannas/samscode/releases/download/v0.0.13/samscode.exe",
    );
  });
});
