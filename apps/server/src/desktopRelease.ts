export interface GitHubReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

export interface GitHubRelease {
  readonly tag_name: string;
  readonly html_url: string;
  readonly assets: ReadonlyArray<GitHubReleaseAsset>;
}

export interface GitHubRepositorySlug {
  readonly owner: string;
  readonly repo: string;
}

export interface DesktopInstallTarget {
  readonly platformLabel: string;
  readonly assetLabel: string;
  readonly preferredSuffixes: ReadonlyArray<string>;
  readonly fallbackSuffixes: ReadonlyArray<string>;
}

export interface DesktopReleaseSummary {
  readonly currentVersion: string;
  readonly platformLabel: string;
  readonly releasesPageUrl: string;
  readonly latestReleaseTag: string | null;
  readonly latestReleaseUrl: string;
  readonly directDownloadLabel: string | null;
  readonly directDownloadUrl: string | null;
}

const GITHUB_URL_PREFIX = "https://github.com/";

function normalizeAssetName(name: string): string {
  return name.trim().toLowerCase();
}

function endsWithAny(value: string, suffixes: ReadonlyArray<string>): boolean {
  return suffixes.some((suffix) => value.endsWith(suffix.toLowerCase()));
}

export function resolveGitHubRepositorySlug(repositoryUrl: string): GitHubRepositorySlug | null {
  const trimmed = repositoryUrl.trim();
  if (!trimmed.startsWith(GITHUB_URL_PREFIX)) {
    return null;
  }

  const remainder = trimmed.slice(GITHUB_URL_PREFIX.length).replace(/\.git$/u, "");
  const [owner, repo, ...rest] = remainder.split("/");
  if (!owner || !repo || rest.length > 0) {
    return null;
  }

  return { owner, repo };
}

export function resolveDesktopInstallTarget(
  platform: NodeJS.Platform,
  arch: string,
): DesktopInstallTarget {
  if (platform === "win32") {
    return {
      platformLabel: arch === "arm64" ? "Windows (ARM64 host)" : "Windows",
      assetLabel: "Windows installer (.exe)",
      preferredSuffixes: [".exe"],
      fallbackSuffixes: [".exe"],
    };
  }

  if (platform === "darwin") {
    if (arch === "arm64") {
      return {
        platformLabel: "macOS (Apple Silicon)",
        assetLabel: "macOS installer (.dmg)",
        preferredSuffixes: ["-arm64.dmg"],
        fallbackSuffixes: [".dmg"],
      };
    }

    return {
      platformLabel: "macOS (Intel)",
      assetLabel: "macOS installer (.dmg)",
      preferredSuffixes: ["-x64.dmg"],
      fallbackSuffixes: [".dmg"],
    };
  }

  if (platform === "linux") {
    return {
      platformLabel: arch === "arm64" ? "Linux (ARM64 host)" : "Linux",
      assetLabel: "Linux AppImage",
      preferredSuffixes: [".appimage"],
      fallbackSuffixes: [".appimage"],
    };
  }

  return {
    platformLabel: `${platform} (${arch})`,
    assetLabel: "Desktop installer",
    preferredSuffixes: [],
    fallbackSuffixes: [],
  };
}

export function pickDesktopReleaseAsset(
  assets: ReadonlyArray<GitHubReleaseAsset>,
  target: DesktopInstallTarget,
): GitHubReleaseAsset | null {
  const normalizedAssets = assets.map((asset) => ({
    asset,
    normalizedName: normalizeAssetName(asset.name),
  }));

  for (const suffix of target.preferredSuffixes) {
    const match = normalizedAssets.find(({ normalizedName }) => normalizedName.endsWith(suffix));
    if (match) {
      return match.asset;
    }
  }

  const fallback = normalizedAssets.find(({ normalizedName }) =>
    endsWithAny(normalizedName, target.fallbackSuffixes),
  );
  return fallback?.asset ?? null;
}

export function renderDesktopReleaseSummary(summary: DesktopReleaseSummary): string {
  const lines = [
    `Sam's Code CLI ${summary.currentVersion}`,
    "",
    `Detected platform: ${summary.platformLabel}`,
    `All releases: ${summary.releasesPageUrl}`,
    summary.latestReleaseTag
      ? `Latest desktop release: ${summary.latestReleaseTag}`
      : "Latest desktop release: unavailable",
    `Release page: ${summary.latestReleaseUrl}`,
  ];

  if (summary.directDownloadUrl && summary.directDownloadLabel) {
    lines.push(`${summary.directDownloadLabel}: ${summary.directDownloadUrl}`);
  } else {
    lines.push("Direct download: not available for this platform yet.");
  }

  lines.push("", "Tip: run `samscode server --help` for the headless/server CLI.");
  return lines.join("\n");
}

export async function fetchLatestGitHubRelease(
  repository: GitHubRepositorySlug,
  userAgent: string,
): Promise<GitHubRelease | null> {
  const response = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": userAgent,
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const parsed = (await response.json()) as Partial<GitHubRelease>;
  if (
    typeof parsed.tag_name !== "string" ||
    typeof parsed.html_url !== "string" ||
    !Array.isArray(parsed.assets)
  ) {
    return null;
  }

  const assets = parsed.assets.flatMap((asset) => {
    if (
      typeof asset !== "object" ||
      asset === null ||
      typeof asset.name !== "string" ||
      typeof asset.browser_download_url !== "string"
    ) {
      return [];
    }

    return [
      {
        name: asset.name,
        browser_download_url: asset.browser_download_url,
      } satisfies GitHubReleaseAsset,
    ];
  });

  return {
    tag_name: parsed.tag_name,
    html_url: parsed.html_url,
    assets,
  };
}
