import { describe, expect, it } from "vitest";

import {
  buildAgentOrchestrationPrompt,
  deriveProviderAvailableComposerAgents,
  extractExplicitAgentMentions,
} from "./agentMentions";

const AGENTS = [
  {
    id: "frontend-developer",
    name: "Frontend Developer",
    description: "Builds the frontend implementation.",
  },
  {
    id: "ui-designer",
    name: "UI Designer",
    description: "Designs polished user interfaces.",
  },
] as const;

describe("extractExplicitAgentMentions", () => {
  it("extracts canonical slug mentions and strips them from the prompt", () => {
    expect(
      extractExplicitAgentMentions({
        prompt: "@frontend-developer @ui-designer create a new add to cart button",
        agents: AGENTS,
      }),
    ).toEqual({
      mentions: [
        {
          id: "frontend-developer",
          name: "Frontend Developer",
          description: "Builds the frontend implementation.",
        },
        {
          id: "ui-designer",
          name: "UI Designer",
          description: "Designs polished user interfaces.",
        },
      ],
      promptWithoutMentions: "create a new add to cart button",
    });
  });

  it("extracts display-name mentions with spaces", () => {
    const extracted = extractExplicitAgentMentions({
      prompt: "@Frontend Developer discuss the landing page",
      agents: AGENTS,
    });
    expect(extracted.mentions.map((mention) => mention.id)).toEqual(["frontend-developer"]);
    expect(extracted.promptWithoutMentions).toBe("discuss the landing page");
  });

  it("extracts quoted mentions with the anthropic agent suffix", () => {
    const extracted = extractExplicitAgentMentions({
      prompt: '@"UI Designer (agent)" review the checkout flow',
      agents: AGENTS,
    });
    expect(extracted.mentions.map((mention) => mention.id)).toEqual(["ui-designer"]);
    expect(extracted.promptWithoutMentions).toBe("review the checkout flow");
  });
});

describe("buildAgentOrchestrationPrompt", () => {
  it("wraps the user request with orchestration instructions", () => {
    const prompt = buildAgentOrchestrationPrompt({
      provider: "codex",
      prompt: "create a new add to cart button",
      mentions: [
        {
          id: "frontend-developer",
          name: "Frontend Developer",
          description: "Builds the frontend implementation.",
        },
      ],
    });

    expect(prompt).toContain("frontend-developer (Frontend Developer)");
    expect(prompt).toContain("Run independent agent work in parallel whenever it helps.");
    expect(prompt).toContain("User request:");
    expect(prompt).toContain("create a new add to cart button");
  });
});

describe("deriveProviderAvailableComposerAgents", () => {
  it("filters down to installed agents for the selected provider", () => {
    const agents = deriveProviderAvailableComposerAgents({
      provider: "claudeAgent",
      entries: [
        {
          id: "frontend-developer",
          name: "Frontend Developer",
          description: "Builds the frontend implementation.",
          supports: ["codex", "claudeAgent"],
          installState: { codex: true, claudeAgent: true },
          source: "workspace",
          sourcePath: "/tmp/frontend-developer.md",
        },
        {
          id: "growth-hacker",
          name: "Growth Hacker",
          description: "Reviews conversion opportunities.",
          supports: ["codex", "claudeAgent"],
          installState: { codex: true, claudeAgent: false },
          source: "workspace",
          sourcePath: "/tmp/growth-hacker.md",
        },
      ],
    });

    expect(agents.map((agent) => agent.id)).toEqual(["frontend-developer"]);
  });
});
