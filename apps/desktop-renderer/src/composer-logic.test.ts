import { describe, expect, it } from "vitest";

import type { ComposerInlineEntityDefinition } from "./composerInlineEntities";
import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
  replaceTextRange,
} from "./composer-logic";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

const INLINE_ENTITIES: ComposerInlineEntityDefinition[] = [
  { kind: "agent", id: "frontend-developer", label: "Frontend Developer" },
  { kind: "agent", id: "ui-designer", label: "UI Designer" },
  { kind: "skill", id: "frontend-design", label: "Frontend Design" },
  { kind: "skill", id: "commit-helper", label: "Commit Helper" },
];

describe("detectComposerTrigger", () => {
  it("detects @agent trigger at cursor", () => {
    const text = "Please check @front";
    const trigger = detectComposerTrigger(text, text.length, INLINE_ENTITIES);

    expect(trigger).toEqual({
      kind: "agent",
      query: "front",
      rangeStart: "Please check ".length,
      rangeEnd: text.length,
    });
  });

  it("detects /skill trigger anywhere in the prompt", () => {
    const text = "Please use /front";
    const trigger = detectComposerTrigger(text, text.length, INLINE_ENTITIES);

    expect(trigger).toEqual({
      kind: "skill",
      query: "front",
      rangeStart: "Please use ".length,
      rangeEnd: text.length,
    });
  });

  it("detects empty /skill trigger immediately after slash", () => {
    const text = "Please use /";
    const trigger = detectComposerTrigger(text, text.length, INLINE_ENTITIES);

    expect(trigger).toEqual({
      kind: "skill",
      query: "",
      rangeStart: "Please use ".length,
      rangeEnd: text.length,
    });
  });

  it("ignores absolute path-like slash tokens", () => {
    expect(
      detectComposerTrigger("Open /usr/local/bin", "Open /usr/local/bin".length, INLINE_ENTITIES),
    ).toBeNull();
  });
});

describe("replaceTextRange", () => {
  it("replaces a text range and returns new cursor", () => {
    const replaced = replaceTextRange("hello /front", 6, 12, "/frontend-design ");
    expect(replaced).toEqual({
      text: "hello /frontend-design ",
      cursor: "hello /frontend-design ".length,
    });
  });
});

describe("expandCollapsedComposerCursor", () => {
  it("keeps cursor unchanged when no inline entity is present", () => {
    expect(expandCollapsedComposerCursor("plain text", 5, INLINE_ENTITIES)).toBe(5);
  });

  it("maps collapsed agent cursor to expanded text cursor", () => {
    const text = "what's in my @frontend-developer next";
    const collapsedCursorAfterMention = "what's in my ".length + 2;
    const expandedCursorAfterMention = "what's in my @frontend-developer ".length;

    expect(expandCollapsedComposerCursor(text, collapsedCursorAfterMention, INLINE_ENTITIES)).toBe(
      expandedCursorAfterMention,
    );
  });

  it("maps collapsed skill cursor to expanded text cursor", () => {
    const text = "Use /frontend-design next";
    const collapsedCursorAfterSkill = "Use ".length + 1;
    const expandedCursorAfterSkill = "Use /frontend-design".length;

    expect(expandCollapsedComposerCursor(text, collapsedCursorAfterSkill, INLINE_ENTITIES)).toBe(
      expandedCursorAfterSkill,
    );
  });
});

describe("collapseExpandedComposerCursor", () => {
  it("maps expanded entity cursor back to collapsed cursor", () => {
    const text = "Use /frontend-design next";
    const collapsedCursorAfterSkill = "Use ".length + 1;
    const expandedCursorAfterSkill = "Use /frontend-design".length;

    expect(collapseExpandedComposerCursor(text, expandedCursorAfterSkill, INLINE_ENTITIES)).toBe(
      collapsedCursorAfterSkill,
    );
  });
});

describe("clampCollapsedComposerCursor", () => {
  it("clamps to collapsed prompt length when entities are present", () => {
    const text = "open /frontend-design then ";

    expect(clampCollapsedComposerCursor(text, text.length, INLINE_ENTITIES)).toBe(
      "open ".length + 1 + " then ".length,
    );
  });
});

describe("isCollapsedCursorAdjacentToInlineToken", () => {
  it("returns false when no entity exists", () => {
    expect(isCollapsedCursorAdjacentToInlineToken("plain text", 6, "left", INLINE_ENTITIES)).toBe(
      false,
    );
  });

  it("detects left adjacency when cursor is after a skill chip", () => {
    const text = "open /frontend-design next";
    const tokenEnd = "open ".length + 1;

    expect(isCollapsedCursorAdjacentToInlineToken(text, tokenEnd, "left", INLINE_ENTITIES)).toBe(
      true,
    );
  });

  it("treats terminal pills as inline tokens for adjacency checks", () => {
    const text = `open ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} next`;
    const tokenStart = "open ".length;
    const tokenEnd = tokenStart + 1;

    expect(isCollapsedCursorAdjacentToInlineToken(text, tokenEnd, "left")).toBe(true);
    expect(isCollapsedCursorAdjacentToInlineToken(text, tokenStart, "right")).toBe(true);
  });
});
