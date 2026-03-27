import { describe, expect, it } from "vitest";

import { splitPromptIntoComposerSegments } from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

const KNOWN_AGENT_IDS = ["frontend-developer", "ui-designer"];

describe("splitPromptIntoComposerSegments", () => {
  it("splits mention tokens followed by whitespace into mention segments", () => {
    expect(
      splitPromptIntoComposerSegments("Inspect @frontend-developer please", [], KNOWN_AGENT_IDS),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", agentId: "frontend-developer" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing mention token", () => {
    expect(
      splitPromptIntoComposerSegments("Inspect @frontend-developer", [], KNOWN_AGENT_IDS),
    ).toEqual([{ type: "text", text: "Inspect @frontend-developer" }]);
  });

  it("does not convert unknown agent mentions", () => {
    expect(
      splitPromptIntoComposerSegments("Inspect @unknown-agent please", [], KNOWN_AGENT_IDS),
    ).toEqual([{ type: "text", text: "Inspect @unknown-agent please" }]);
  });

  it("keeps newlines around mention tokens", () => {
    expect(splitPromptIntoComposerSegments("one\n@ui-designer \ntwo", [], KNOWN_AGENT_IDS)).toEqual(
      [
        { type: "text", text: "one\n" },
        { type: "mention", agentId: "ui-designer" },
        { type: "text", text: " \ntwo" },
      ],
    );
  });

  it("keeps inline terminal context placeholders at their prompt positions", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@frontend-developer please`,
        [],
        KNOWN_AGENT_IDS,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "mention", agentId: "frontend-developer" },
      { type: "text", text: " please" },
    ]);
  });
});
