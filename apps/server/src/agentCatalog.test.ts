import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installCatalogAgent, listAgentCatalog } from "./agentCatalog";

const tempDirectories: string[] = [];
const originalCatalogRoot = process.env.SAMSCODE_CATALOG_ROOT;

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  if (originalCatalogRoot === undefined) {
    delete process.env.SAMSCODE_CATALOG_ROOT;
  } else {
    process.env.SAMSCODE_CATALOG_ROOT = originalCatalogRoot;
  }
  await Promise.all(
    tempDirectories
      .splice(0, tempDirectories.length)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
  await Promise.all([
    fs.rm(path.join(os.homedir(), ".claude", "agents", "frontend-developer.md"), {
      force: true,
    }),
    fs.rm(path.join(os.homedir(), ".claude", "agents", "ui-designer.md"), {
      force: true,
    }),
  ]);
});

beforeEach(async () => {
  delete process.env.SAMSCODE_CATALOG_ROOT;
  await Promise.all([
    fs.rm(path.join(os.homedir(), ".claude", "agents", "frontend-developer.md"), {
      force: true,
    }),
    fs.rm(path.join(os.homedir(), ".claude", "agents", "ui-designer.md"), {
      force: true,
    }),
  ]);
});

describe("agentCatalog", () => {
  it("lists workspace agents and reports install state", async () => {
    const workspaceRoot = await makeTempDir("samscode-agent-workspace-");
    const baseDir = await makeTempDir("samscode-agent-base-");
    await fs.mkdir(path.join(workspaceRoot, "agents", "catalog", "engineering"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspaceRoot, "agents", "catalog", "engineering", "frontend-developer.md"),
      [
        "---",
        "name: frontend-developer",
        "description: Builds polished frontend features.",
        "---",
        "",
        "You are a frontend developer.",
      ].join("\n"),
      "utf8",
    );

    const result = await listAgentCatalog({
      cwd: workspaceRoot,
      baseDir,
      codexHomePath: path.join(baseDir, "codex-home"),
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: "frontend-developer",
      category: "engineering",
      installState: {
        codex: false,
        claudeAgent: false,
      },
    });
  });

  it("falls back to bundled catalog agents when workspace cwd has no agents", async () => {
    const workspaceRoot = await makeTempDir("samscode-agent-workspace-");
    const bundledRoot = await makeTempDir("samscode-agent-bundled-");
    const baseDir = await makeTempDir("samscode-agent-base-");
    process.env.SAMSCODE_CATALOG_ROOT = bundledRoot;

    await fs.mkdir(path.join(bundledRoot, "agents", "catalog", "engineering"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(bundledRoot, "agents", "catalog", "engineering", "frontend-developer.md"),
      [
        "---",
        "name: frontend-developer",
        "description: Builds polished frontend features.",
        "---",
        "",
        "You are a frontend developer.",
      ].join("\n"),
      "utf8",
    );

    const result = await listAgentCatalog({
      cwd: workspaceRoot,
      baseDir,
      codexHomePath: path.join(baseDir, "codex-home"),
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: "frontend-developer",
      source: "workspace",
      sourcePath: path.join(
        bundledRoot,
        "agents",
        "catalog",
        "engineering",
        "frontend-developer.md",
      ),
    });
  });

  it("installs a catalog agent into the configured codex home", async () => {
    const workspaceRoot = await makeTempDir("samscode-agent-workspace-");
    const baseDir = await makeTempDir("samscode-agent-base-");
    const codexHome = path.join(baseDir, "codex-home");
    await fs.mkdir(path.join(workspaceRoot, "agents", "catalog"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, "agents", "catalog", "ui-designer.md"),
      [
        "---",
        "name: ui-designer",
        "description: Designs polished interfaces.",
        "sandbox_mode: read-only",
        "---",
        "",
        "You are a UI designer.",
      ].join("\n"),
      "utf8",
    );

    const result = await installCatalogAgent({
      cwd: workspaceRoot,
      baseDir,
      agentId: "ui-designer",
      target: "codex",
      codexHomePath: codexHome,
      activeSessions: [],
    });

    const installedPath = path.join(codexHome, "agents", "ui-designer.toml");
    const installedContents = await fs.readFile(installedPath, "utf8");
    expect(result.installState.codex).toBe(true);
    expect(installedContents).toContain('name = "ui-designer"');
    expect(installedContents).toContain('sandbox_mode = "read-only"');
  });
});
