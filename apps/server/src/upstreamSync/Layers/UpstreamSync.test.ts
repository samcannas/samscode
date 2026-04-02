import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { UPSTREAM_SYNC_SCHEMA_VERSION } from "@samscode/contracts";
import { UpstreamSyncTestHelpers } from "./UpstreamSync";

const tempDirs: string[] = [];

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upstream-sync-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("UpstreamSync cache compatibility", () => {
  it("migrates v1 config files before resolving sync config", async () => {
    const cwd = await makeTempRepo();
    const paths = UpstreamSyncTestHelpers.resolveSyncPaths(cwd);
    await UpstreamSyncTestHelpers.writeJsonFile(paths.forkMetadataPath, {
      schemaVersion: 1,
      upstream: {
        repo: "pingdotgg/t3code",
        defaultBranch: "main",
        releaseChannel: "stable",
      },
      forkOrigin: {
        baseReleaseTag: "v0.0.13",
        baseCommitSha: "2a237c20019af8eae1020511b41256ea93127e4c",
        confidence: "derived-from-repo-analysis",
        evidence: "Closest upstream snapshot for the local root commit matches T3 Code v0.0.13.",
      },
      tracking: {
        lastFullyTriagedReleaseTag: "v999.0.0",
        lastFetchedReleaseTag: null,
      },
      defaults: {
        implementationMode: "logic-first",
      },
    });
    await UpstreamSyncTestHelpers.writeJsonFile(paths.areasPath, {
      schemaVersion: 1,
      areas: [
        {
          id: "server",
          label: "Server runtime",
          pathPrefixes: ["apps/server/"],
          titleKeywords: ["server"],
          defaultDecision: "apply",
        },
      ],
    });

    const ensured = await UpstreamSyncTestHelpers.ensureSyncConfig(cwd);

    expect(ensured.forkMetadata.schemaVersion).toBe(UPSTREAM_SYNC_SCHEMA_VERSION);
    expect(ensured.areaPolicies.schemaVersion).toBe(UPSTREAM_SYNC_SCHEMA_VERSION);

    const migratedFork = JSON.parse(await fs.readFile(paths.forkMetadataPath, "utf8"));
    const migratedAreas = JSON.parse(await fs.readFile(paths.areasPath, "utf8"));
    expect(migratedFork.schemaVersion).toBe(UPSTREAM_SYNC_SCHEMA_VERSION);
    expect(migratedAreas.schemaVersion).toBe(UPSTREAM_SYNC_SCHEMA_VERSION);
  });

  it("invalidates old intakes with fallback analysis", async () => {
    const cwd = await makeTempRepo();
    const paths = UpstreamSyncTestHelpers.resolveSyncPaths(cwd);
    await UpstreamSyncTestHelpers.writeJsonFile(paths.intakePath("v0.0.14"), {
      schemaVersion: 1,
      tag: "v0.0.14",
      name: "v0.0.14",
      url: "https://example.com",
      publishedAt: null,
      previousTag: "v0.0.13",
      compareUrl: null,
      fetchedAt: "2026-03-30T12:00:00.000Z",
      releaseNotes: "",
      analysis: {
        source: "heuristic-fallback",
        model: "gpt-5-codex",
        startedAt: "2026-03-30T12:00:00.000Z",
        completedAt: "2026-03-30T12:00:01.000Z",
        durationMs: 1000,
        modeledCandidateCount: 0,
        heuristicCandidateCount: 1,
        notes: [],
      },
      candidates: [],
    });

    const parsed = await UpstreamSyncTestHelpers.readReleaseIntake(paths, "v0.0.14");

    expect(parsed).toBeNull();
    await expect(fs.stat(paths.intakePath("v0.0.14"))).rejects.toThrow();
  });

  it("migrates defer triage decisions to pending", async () => {
    const cwd = await makeTempRepo();
    const paths = UpstreamSyncTestHelpers.resolveSyncPaths(cwd);
    await UpstreamSyncTestHelpers.writeJsonFile(paths.triagePath("v0.0.14"), {
      schemaVersion: 1,
      tag: "v0.0.14",
      updatedAt: "2026-03-30T12:00:00.000Z",
      decisions: [
        {
          candidateId: "commit-123",
          decision: "defer",
          note: "Need to revisit after migration.",
        },
      ],
    });

    const parsed = await UpstreamSyncTestHelpers.readReleaseTriage(paths, "v0.0.14");

    expect(parsed).not.toBeNull();
    expect(parsed?.schemaVersion).toBe(UPSTREAM_SYNC_SCHEMA_VERSION);
    expect(parsed?.decisions).toEqual([
      {
        candidateId: "commit-123",
        decision: "pending",
        note: "Need to revisit after migration.",
      },
    ]);
  });

  it("builds an idle review state snapshot", () => {
    const state = UpstreamSyncTestHelpers.buildIdleReviewState("/repo");

    expect(state).toMatchObject({
      cwd: "/repo",
      status: "idle",
      phase: "idle",
      releaseTag: null,
      candidateCount: null,
      completedCandidateCount: 0,
      error: null,
    });
  });

  it("builds a starting review state snapshot", () => {
    const state = UpstreamSyncTestHelpers.buildStartingReviewState(
      "/repo",
      "2026-03-30T12:00:00.000Z",
    );

    expect(state).toMatchObject({
      cwd: "/repo",
      status: "running",
      phase: "fetching-upstream",
      releaseTag: null,
      startedAt: "2026-03-30T12:00:00.000Z",
      message: "Checking for the next upstream release.",
      error: null,
    });
  });
});
