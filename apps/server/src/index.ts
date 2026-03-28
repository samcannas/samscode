import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CliConfig, scCli } from "./main";
import { OpenLive } from "./open";
import { Command } from "effect/unstable/cli";
import { repository, version } from "../package.json" with { type: "json" };
import { ServerLive } from "./wsServer";
import { NetService } from "@samscode/shared/Net";
import { FetchHttpClient } from "effect/unstable/http";
import {
  fetchLatestGitHubRelease,
  pickDesktopReleaseAsset,
  renderDesktopReleaseSummary,
  resolveDesktopInstallTarget,
  resolveGitHubRepositorySlug,
} from "./desktopRelease";

const RuntimeLayer = Layer.empty.pipe(
  Layer.provideMerge(CliConfig.layer),
  Layer.provideMerge(ServerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

function renderRootHelp(): string {
  return [
    `Sam's Code CLI ${version}`,
    "",
    "Usage:",
    "  samscode                Show desktop release links for this OS",
    "  samscode desktop        Show desktop release links for this OS",
    "  samscode server [args]  Run the Sam's Code server",
    "  samscode --version      Show CLI version",
    "",
    "Short alias:",
    "  sc [args]               Run the Sam's Code server",
  ].join("\n");
}

async function printDesktopReleaseInfo(): Promise<void> {
  const repositoryUrl = typeof repository?.url === "string" ? repository.url : "";
  const repositorySlug = resolveGitHubRepositorySlug(repositoryUrl);

  if (!repositorySlug) {
    console.log(
      renderDesktopReleaseSummary({
        currentVersion: version,
        platformLabel: resolveDesktopInstallTarget(process.platform, process.arch).platformLabel,
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
  const target = resolveDesktopInstallTarget(process.platform, process.arch);

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

  const serverArgs = firstArg === "server" ? argv.slice(1) : argv;
  Command.runWith(scCli, { version })(serverArgs).pipe(
    Effect.provide(RuntimeLayer),
    NodeRuntime.runMain,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
