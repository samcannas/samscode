import { describe, expect, it } from "vitest";

import type { ComposerInlineEntityDefinition } from "./composerInlineEntities";
import { splitPromptIntoComposerSegments } from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

const INLINE_ENTITIES: ComposerInlineEntityDefinition[] = [
  { kind: "agent", id: "frontend-developer", label: "Frontend Developer" },
  { kind: "skill", id: "frontend-design", label: "Frontend Design" },
];

describe("splitPromptIntoComposerSegments", () => {
  it("splits agent tokens followed by whitespace into entity segments", () => {
    expect(
      splitPromptIntoComposerSegments("Inspect @frontend-developer please", [], INLINE_ENTITIES),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "entity", entityKind: "agent", entityId: "frontend-developer" },
      { type: "text", text: " please" },
    ]);
  });

  it("splits skill tokens followed by whitespace into entity segments", () => {
    expect(
      splitPromptIntoComposerSegments("Use /frontend-design please", [], INLINE_ENTITIES),
    ).toEqual([
      { type: "text", text: "Use " },
      { type: "entity", entityKind: "skill", entityId: "frontend-design" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing skill token", () => {
    expect(splitPromptIntoComposerSegments("Use /frontend-design", [], INLINE_ENTITIES)).toEqual([
      { type: "text", text: "Use /frontend-design" },
    ]);
  });

  it("keeps inline terminal context placeholders at their prompt positions", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}/frontend-design please`,
        [],
        INLINE_ENTITIES,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "entity", entityKind: "skill", entityId: "frontend-design" },
      { type: "text", text: " please" },
    ]);
  });
});
