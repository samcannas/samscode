import { describe, expect, it } from "vitest";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
  parseStandaloneComposerSlashCommand,
  replaceTextRange,
} from "./composer-logic";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

const KNOWN_AGENT_IDS = ["frontend-developer", "ui-designer"];

describe("detectComposerTrigger", () => {
  it("detects @agent trigger at cursor", () => {
    const text = "Please check @front";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "agent",
      query: "front",
      rangeStart: "Please check ".length,
      rangeEnd: text.length,
    });
  });

  it("detects slash command token while typing command name", () => {
    const text = "/mo";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "slash-command",
      query: "mo",
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("detects slash model query after /model", () => {
    const text = "/model spark";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "slash-model",
      query: "spark",
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("detects non-model slash commands while typing", () => {
    const text = "/pl";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "slash-command",
      query: "pl",
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("detects @agent trigger in the middle of existing text", () => {
    const text = "Please inspect @in this sentence";
    const cursorAfterAt = "Please inspect @".length;

    const trigger = detectComposerTrigger(text, cursorAfterAt);
    expect(trigger).toEqual({
      kind: "agent",
      query: "",
      rangeStart: "Please inspect ".length,
      rangeEnd: cursorAfterAt,
    });
  });

  it("detects @agent trigger with query typed mid-text", () => {
    const text = "Please inspect @srin this sentence";
    const cursorAfterQuery = "Please inspect @sr".length;

    const trigger = detectComposerTrigger(text, cursorAfterQuery);
    expect(trigger).toEqual({
      kind: "agent",
      query: "sr",
      rangeStart: "Please inspect ".length,
      rangeEnd: cursorAfterQuery,
    });
  });

  it("detects trigger with true cursor even when plain text could false-match", () => {
    const text = "Please inspect @in this sentence";
    const cursorAfterAt = "Please inspect @".length;

    const trigger = detectComposerTrigger(text, cursorAfterAt);
    expect(trigger).not.toBeNull();
    expect(trigger?.kind).toBe("agent");
    expect(trigger?.query).toBe("");
  });
});

describe("replaceTextRange", () => {
  it("replaces a text range and returns new cursor", () => {
    const replaced = replaceTextRange("hello @front", 6, 12, "");
    expect(replaced).toEqual({
      text: "hello ",
      cursor: 6,
    });
  });
});

describe("expandCollapsedComposerCursor", () => {
  it("keeps cursor unchanged when no mention segment is present", () => {
    expect(expandCollapsedComposerCursor("plain text", 5)).toBe(5);
  });

  it("maps collapsed mention cursor to expanded text cursor", () => {
    const text = "what's in my @frontend-developer fsfdas";
    const collapsedCursorAfterMention = "what's in my ".length + 2;
    const expandedCursorAfterMention = "what's in my @frontend-developer ".length;

    expect(expandCollapsedComposerCursor(text, collapsedCursorAfterMention, KNOWN_AGENT_IDS)).toBe(
      expandedCursorAfterMention,
    );
  });

  it("allows trigger detection to close after selecting a mention", () => {
    const text = "what's in my @frontend-developer ";
    const collapsedCursorAfterMention = "what's in my ".length + 2;
    const expandedCursor = expandCollapsedComposerCursor(
      text,
      collapsedCursorAfterMention,
      KNOWN_AGENT_IDS,
    );

    expect(detectComposerTrigger(text, expandedCursor)).toBeNull();
  });
});

describe("collapseExpandedComposerCursor", () => {
  it("keeps cursor unchanged when no mention segment is present", () => {
    expect(collapseExpandedComposerCursor("plain text", 5)).toBe(5);
  });

  it("maps expanded mention cursor back to collapsed cursor", () => {
    const text = "what's in my @frontend-developer fsfdas";
    const collapsedCursorAfterMention = "what's in my ".length + 2;
    const expandedCursorAfterMention = "what's in my @frontend-developer ".length;

    expect(collapseExpandedComposerCursor(text, expandedCursorAfterMention, KNOWN_AGENT_IDS)).toBe(
      collapsedCursorAfterMention,
    );
  });

  it("keeps replacement cursors aligned when another mention already exists earlier", () => {
    const text = "open @frontend-developer then @ui-designer ";
    const expandedCursor = text.length;
    const collapsedCursor = collapseExpandedComposerCursor(text, expandedCursor, KNOWN_AGENT_IDS);

    expect(collapsedCursor).toBe("open ".length + 1 + " then ".length + 2);
    expect(expandCollapsedComposerCursor(text, collapsedCursor, KNOWN_AGENT_IDS)).toBe(
      expandedCursor,
    );
  });
});

describe("clampCollapsedComposerCursor", () => {
  it("clamps to collapsed prompt length when mentions are present", () => {
    const text = "open @frontend-developer then ";

    expect(clampCollapsedComposerCursor(text, text.length, KNOWN_AGENT_IDS)).toBe(
      "open ".length + 1 + " then ".length,
    );
    expect(clampCollapsedComposerCursor(text, Number.POSITIVE_INFINITY, KNOWN_AGENT_IDS)).toBe(
      "open ".length + 1 + " then ".length,
    );
  });
});

describe("replaceTextRange trailing space consumption", () => {
  it("double space after insertion when replacement ends with space", () => {
    const text = "and then @front summarize";
    const rangeStart = "and then ".length;
    const rangeEnd = "and then @front".length;

    const withoutConsume = replaceTextRange(text, rangeStart, rangeEnd, "@frontend-developer ");
    expect(withoutConsume.text).toBe("and then @frontend-developer  summarize");

    const extendedEnd = text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
    const withConsume = replaceTextRange(text, rangeStart, extendedEnd, "@frontend-developer ");
    expect(withConsume.text).toBe("and then @frontend-developer summarize");
  });
});

describe("isCollapsedCursorAdjacentToInlineToken", () => {
  it("returns false when no mention exists", () => {
    expect(isCollapsedCursorAdjacentToInlineToken("plain text", 6, "left")).toBe(false);
    expect(isCollapsedCursorAdjacentToInlineToken("plain text", 6, "right")).toBe(false);
  });

  it("keeps @query typing non-adjacent while no mention pill exists", () => {
    const text = "hello @pac";
    expect(isCollapsedCursorAdjacentToInlineToken(text, text.length, "left")).toBe(false);
    expect(isCollapsedCursorAdjacentToInlineToken(text, text.length, "right")).toBe(false);
  });

  it("detects left adjacency only when cursor is directly after a mention", () => {
    const text = "open @frontend-developer next";
    const mentionStart = "open ".length;
    const mentionEnd = mentionStart + 1;

    expect(isCollapsedCursorAdjacentToInlineToken(text, mentionEnd, "left", KNOWN_AGENT_IDS)).toBe(
      true,
    );
    expect(
      isCollapsedCursorAdjacentToInlineToken(text, mentionStart, "left", KNOWN_AGENT_IDS),
    ).toBe(false);
    expect(
      isCollapsedCursorAdjacentToInlineToken(text, mentionEnd + 1, "left", KNOWN_AGENT_IDS),
    ).toBe(false);
  });

  it("detects right adjacency only when cursor is directly before a mention", () => {
    const text = "open @frontend-developer next";
    const mentionStart = "open ".length;
    const mentionEnd = mentionStart + 1;

    expect(
      isCollapsedCursorAdjacentToInlineToken(text, mentionStart, "right", KNOWN_AGENT_IDS),
    ).toBe(true);
    expect(isCollapsedCursorAdjacentToInlineToken(text, mentionEnd, "right", KNOWN_AGENT_IDS)).toBe(
      false,
    );
    expect(
      isCollapsedCursorAdjacentToInlineToken(text, mentionStart - 1, "right", KNOWN_AGENT_IDS),
    ).toBe(false);
  });

  it("treats terminal pills as inline tokens for adjacency checks", () => {
    const text = `open ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} next`;
    const tokenStart = "open ".length;
    const tokenEnd = tokenStart + 1;

    expect(isCollapsedCursorAdjacentToInlineToken(text, tokenEnd, "left")).toBe(true);
    expect(isCollapsedCursorAdjacentToInlineToken(text, tokenStart, "right")).toBe(true);
  });
});

describe("parseStandaloneComposerSlashCommand", () => {
  it("parses standalone /plan command", () => {
    expect(parseStandaloneComposerSlashCommand(" /plan ")).toBe("plan");
  });

  it("parses standalone /default command", () => {
    expect(parseStandaloneComposerSlashCommand("/default")).toBe("default");
  });

  it("ignores slash commands with extra message text", () => {
    expect(parseStandaloneComposerSlashCommand("/plan explain this")).toBeNull();
  });
});
