import { repository, version } from "../package.json" with { type: "json" };
import {
  fetchLatestGitHubRelease,
  pickDesktopReleaseAsset,
  renderDesktopReleaseSummary,
  resolveDesktopInstallTarget,
  resolveGitHubRepositorySlug,
} from "./desktopRelease";

function renderRootHelp(): string {
  return [
    `Sam's Code helper ${version}`,
    "",
    "Usage:",
    "  samscode            Show desktop release links for this OS",
    "  samscode desktop    Show desktop release links for this OS",
    "  samscode install    Show desktop release links for this OS",
    "  samscode release    Show desktop release links for this OS",
    "  samscode --version  Show helper version",
  ].join("\n");
}

async function printDesktopReleaseInfo(): Promise<void> {
  const repositoryUrl = typeof repository?.url === "string" ? repository.url : "";
  const repositorySlug = resolveGitHubRepositorySlug(repositoryUrl);
  const target = resolveDesktopInstallTarget(process.platform, process.arch);

  if (!repositorySlug) {
    console.log(
      renderDesktopReleaseSummary({
        currentVersion: version,
        platformLabel: target.platformLabel,
        releasesPageUrl: repositoryUrl || "Unavailable",
        latestReleaseTag: null,
        latestReleaseUrl: repositoryUrl || "Unavailable",
        directDownloadLabel: null,
        directDownloadUrl: null,
      }),
    );
    return;
  }

  const releasesPageUrl = `https://github.com/${repositorySlug.owner}/${repositorySlug.repo}/releases`;

  try {
    const latestRelease = await fetchLatestGitHubRelease(repositorySlug, `samscode/${version}`);
    const directAsset = latestRelease
      ? pickDesktopReleaseAsset(latestRelease.assets, target)
      : null;

    console.log(
      renderDesktopReleaseSummary({
        currentVersion: version,
        platformLabel: target.platformLabel,
        releasesPageUrl,
        latestReleaseTag: latestRelease?.tag_name ?? null,
        latestReleaseUrl: latestRelease?.html_url ?? `${releasesPageUrl}/latest`,
        directDownloadLabel: directAsset ? target.assetLabel : null,
        directDownloadUrl: directAsset?.browser_download_url ?? null,
      }),
    );
  } catch {
    console.log(
      renderDesktopReleaseSummary({
        currentVersion: version,
        platformLabel: target.platformLabel,
        releasesPageUrl,
        latestReleaseTag: null,
        latestReleaseUrl: `${releasesPageUrl}/latest`,
        directDownloadLabel: null,
        directDownloadUrl: null,
      }),
    );
  }
}

const argv = process.argv.slice(2);
const firstArg = argv[0];

async function main(): Promise<void> {
  if (
    firstArg === undefined ||
    firstArg === "desktop" ||
    firstArg === "install" ||
    firstArg === "release"
  ) {
    await printDesktopReleaseInfo();
    return;
  }

  if (firstArg === "--version" || firstArg === "-v") {
    console.log(version);
    return;
  }

  if (firstArg === "--help" || firstArg === "-h" || firstArg === "help") {
    console.log(renderRootHelp());
    return;
  }

  console.error(`Unknown command: ${firstArg}`);
  console.error("");
  console.error(renderRootHelp());
  process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
