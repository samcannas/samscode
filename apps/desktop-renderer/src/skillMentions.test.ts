import { describe, expect, it } from "vitest";

import {
  deriveProviderAvailableComposerSkills,
  extractExplicitSkillMentions,
} from "./skillMentions";

const SKILLS = [
  {
    id: "frontend-design",
    name: "Frontend Design",
    description: "Design polished interfaces.",
  },
  {
    id: "commit-helper",
    name: "Commit Helper",
    description: "Prepare semantic git commits.",
  },
] as const;

describe("extractExplicitSkillMentions", () => {
  it("extracts slash skill mentions and strips them from the prompt", () => {
    expect(
      extractExplicitSkillMentions({
        prompt: "/frontend-design /commit-helper polish the UI",
        skills: SKILLS,
      }),
    ).toEqual({
      mentions: [
        {
          id: "frontend-design",
          name: "Frontend Design",
          description: "Design polished interfaces.",
        },
        {
          id: "commit-helper",
          name: "Commit Helper",
          description: "Prepare semantic git commits.",
        },
      ],
      promptWithoutMentions: "polish the UI",
    });
  });

  it("leaves unknown slash commands untouched", () => {
    expect(
      extractExplicitSkillMentions({
        prompt: "/unknown keep this text",
        skills: SKILLS,
      }),
    ).toEqual({
      mentions: [],
      promptWithoutMentions: "/unknown keep this text",
    });
  });
});

describe("deriveProviderAvailableComposerSkills", () => {
  it("filters down to installed, user-invocable skills for the selected provider", () => {
    const skills = deriveProviderAvailableComposerSkills({
      provider: "claudeAgent",
      entries: [
        {
          id: "frontend-design",
          name: "Frontend Design",
          description: "Design polished interfaces.",
          supports: ["codex", "claudeAgent"],
          installState: { codex: true, claudeAgent: true },
          source: "workspace",
          sourcePath: "/tmp/frontend-design",
          entrypointPath: "/tmp/frontend-design/SKILL.md",
          supportingFileCount: 1,
          hasScripts: false,
          userInvocable: true,
          implicitInvocationEnabled: true,
        },
        {
          id: "hidden-skill",
          name: "Hidden Skill",
          description: "Should not appear.",
          supports: ["codex", "claudeAgent"],
          installState: { codex: true, claudeAgent: true },
          source: "workspace",
          sourcePath: "/tmp/hidden-skill",
          entrypointPath: "/tmp/hidden-skill/SKILL.md",
          supportingFileCount: 0,
          hasScripts: false,
          userInvocable: false,
          implicitInvocationEnabled: true,
        },
      ],
    });

    expect(skills.map((skill) => skill.id)).toEqual(["frontend-design"]);
  });
});
