import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { installCatalogAgent, listAgentCatalog } from "./agentCatalog";

const tempDirectories: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0, tempDirectories.length)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
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
