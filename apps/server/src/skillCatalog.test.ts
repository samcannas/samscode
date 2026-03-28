import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildInstalledSkillPrompt, installCatalogSkill, listSkillCatalog } from "./skillCatalog";

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
  await Promise.all([
    fs.rm(path.join(os.homedir(), ".agents", "skills", "frontend-design"), {
      recursive: true,
      force: true,
    }),
    fs.rm(path.join(os.homedir(), ".claude", "skills", "frontend-design"), {
      recursive: true,
      force: true,
    }),
  ]);
});

beforeEach(async () => {
  await Promise.all([
    fs.rm(path.join(os.homedir(), ".agents", "skills", "frontend-design"), {
      recursive: true,
      force: true,
    }),
    fs.rm(path.join(os.homedir(), ".claude", "skills", "frontend-design"), {
      recursive: true,
      force: true,
    }),
  ]);
});

describe("skillCatalog", () => {
  it("lists workspace skills and reports install state", async () => {
    const workspaceRoot = await makeTempDir("samscode-skill-workspace-");
    const baseDir = await makeTempDir("samscode-skill-base-");
    await fs.mkdir(path.join(workspaceRoot, "skills", "catalog", "design", "frontend-design"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspaceRoot, "skills", "catalog", "design", "frontend-design", "SKILL.md"),
      [
        "---",
        "name: frontend-design",
        "description: Builds polished interfaces.",
        "argument-hint: [brief]",
        "---",
        "",
        "Build polished interfaces.",
      ].join("\n"),
      "utf8",
    );

    const result = await listSkillCatalog({
      cwd: workspaceRoot,
      baseDir,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: "frontend-design",
      category: "design",
      argumentHint: "[brief]",
      installState: {
        codex: false,
        claudeAgent: false,
      },
    });
  });

  it("installs a catalog skill into the native harness directories", async () => {
    const workspaceRoot = await makeTempDir("samscode-skill-workspace-");
    const baseDir = await makeTempDir("samscode-skill-base-");
    await fs.mkdir(path.join(workspaceRoot, "skills", "catalog", "frontend-design", "scripts"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspaceRoot, "skills", "catalog", "frontend-design", "SKILL.md"),
      [
        "---",
        "name: frontend-design",
        "description: Builds polished interfaces.",
        "---",
        "",
        "Build polished interfaces.",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceRoot, "skills", "catalog", "frontend-design", "scripts", "helper.sh"),
      "echo hello\n",
      "utf8",
    );

    const result = await installCatalogSkill({
      cwd: workspaceRoot,
      baseDir,
      skillId: "frontend-design",
      target: "all",
    });

    expect(result.installState).toEqual({ codex: true, claudeAgent: true });
    expect(
      await fs.readFile(
        path.join(os.homedir(), ".agents", "skills", "frontend-design", "SKILL.md"),
        "utf8",
      ),
    ).toContain("Build polished interfaces.");
    expect(
      await fs.readFile(
        path.join(os.homedir(), ".claude", "skills", "frontend-design", "scripts", "helper.sh"),
        "utf8",
      ),
    ).toContain("echo hello");
  });

  it("builds provider prompt text with skill instructions and supporting files", async () => {
    const workspaceRoot = await makeTempDir("samscode-skill-workspace-");
    const baseDir = await makeTempDir("samscode-skill-base-");
    await fs.mkdir(path.join(workspaceRoot, "skills", "catalog", "frontend-design", "references"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspaceRoot, "skills", "catalog", "frontend-design", "SKILL.md"),
      [
        "---",
        "name: frontend-design",
        "description: Builds polished interfaces.",
        "---",
        "",
        "Build polished interfaces.",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceRoot, "skills", "catalog", "frontend-design", "references", "tokens.md"),
      "Use warm neutrals.\n",
      "utf8",
    );

    await installCatalogSkill({
      cwd: workspaceRoot,
      baseDir,
      skillId: "frontend-design",
      target: "codex",
    });

    const result = await buildInstalledSkillPrompt({
      cwd: workspaceRoot,
      baseDir,
      provider: "codex",
      prompt: "Refresh the landing page",
      skillIds: ["frontend-design"],
    });

    expect(result.prompt).toContain("The user explicitly activated these installed Codex skills");
    expect(result.prompt).toContain("## Skill: frontend-design (Frontend Design)");
    expect(result.prompt).toContain("Build polished interfaces.");
    expect(result.prompt).toContain("references");
    expect(result.prompt).toContain("tokens.md");
    expect(result.prompt).toContain("Refresh the landing page");
  });
});
