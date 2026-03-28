import type { ComposerInlineEntityDefinition } from "./composerInlineEntities";
import { splitPromptIntoComposerSegments } from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

export type ComposerTriggerKind = "agent" | "skill";

export interface ComposerTrigger {
  kind: ComposerTriggerKind;
  query: string;
  rangeStart: number;
  rangeEnd: number;
}

const isInlineTokenSegment = (
  segment: { type: "text"; text: string } | { type: "entity" } | { type: "terminal-context" },
): boolean => segment.type !== "text";

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

function isWhitespace(char: string): boolean {
  return (
    char === " " ||
    char === "\n" ||
    char === "\t" ||
    char === "\r" ||
    char === INLINE_TERMINAL_CONTEXT_PLACEHOLDER
  );
}

function tokenStartForCursor(text: string, cursor: number): number {
  let index = cursor - 1;
  while (index >= 0 && !isWhitespace(text[index] ?? "")) {
    index -= 1;
  }
  return index + 1;
}

function inlineEntityKey(entity: ComposerInlineEntityDefinition): string {
  return `${entity.kind}:${entity.id}`;
}

export function expandCollapsedComposerCursor(
  text: string,
  cursorInput: number,
  inlineEntities: ReadonlyArray<ComposerInlineEntityDefinition> = [],
): number {
  const collapsedCursor = clampCursor(text, cursorInput);
  const segments = splitPromptIntoComposerSegments(text, [], inlineEntities);
  if (segments.length === 0) {
    return collapsedCursor;
  }

  let remaining = collapsedCursor;
  let expandedCursor = 0;

  for (const segment of segments) {
    if (segment.type === "entity") {
      const prefix = segment.entityKind === "agent" ? "@" : "/";
      const expandedLength = segment.entityId.length + prefix.length;
      if (remaining <= 1) {
        return expandedCursor + (remaining === 0 ? 0 : expandedLength);
      }
      remaining -= 1;
      expandedCursor += expandedLength;
      continue;
    }
    if (segment.type === "terminal-context") {
      if (remaining <= 1) {
        return expandedCursor + remaining;
      }
      remaining -= 1;
      expandedCursor += 1;
      continue;
    }

    const segmentLength = segment.text.length;
    if (remaining <= segmentLength) {
      return expandedCursor + remaining;
    }
    remaining -= segmentLength;
    expandedCursor += segmentLength;
  }

  return expandedCursor;
}

function collapsedSegmentLength(
  segment: { type: "text"; text: string } | { type: "entity" } | { type: "terminal-context" },
): number {
  if (segment.type === "text") {
    return segment.text.length;
  }
  return 1;
}

function clampCollapsedComposerCursorForSegments(
  segments: ReadonlyArray<
    { type: "text"; text: string } | { type: "entity" } | { type: "terminal-context" }
  >,
  cursorInput: number,
): number {
  const collapsedLength = segments.reduce(
    (total, segment) => total + collapsedSegmentLength(segment),
    0,
  );
  if (!Number.isFinite(cursorInput)) {
    return collapsedLength;
  }
  return Math.max(0, Math.min(collapsedLength, Math.floor(cursorInput)));
}

export function clampCollapsedComposerCursor(
  text: string,
  cursorInput: number,
  inlineEntities: ReadonlyArray<ComposerInlineEntityDefinition> = [],
): number {
  return clampCollapsedComposerCursorForSegments(
    splitPromptIntoComposerSegments(text, [], inlineEntities),
    cursorInput,
  );
}

export function collapseExpandedComposerCursor(
  text: string,
  cursorInput: number,
  inlineEntities: ReadonlyArray<ComposerInlineEntityDefinition> = [],
): number {
  const expandedCursor = clampCursor(text, cursorInput);
  const segments = splitPromptIntoComposerSegments(text, [], inlineEntities);
  if (segments.length === 0) {
    return expandedCursor;
  }

  let remaining = expandedCursor;
  let collapsedCursor = 0;

  for (const segment of segments) {
    if (segment.type === "entity") {
      const prefix = segment.entityKind === "agent" ? "@" : "/";
      const expandedLength = segment.entityId.length + prefix.length;
      if (remaining === 0) {
        return collapsedCursor;
      }
      if (remaining <= expandedLength) {
        return collapsedCursor + 1;
      }
      remaining -= expandedLength;
      collapsedCursor += 1;
      continue;
    }
    if (segment.type === "terminal-context") {
      if (remaining <= 1) {
        return collapsedCursor + remaining;
      }
      remaining -= 1;
      collapsedCursor += 1;
      continue;
    }

    const segmentLength = segment.text.length;
    if (remaining <= segmentLength) {
      return collapsedCursor + remaining;
    }
    remaining -= segmentLength;
    collapsedCursor += segmentLength;
  }

  return collapsedCursor;
}

export function isCollapsedCursorAdjacentToInlineToken(
  text: string,
  cursorInput: number,
  direction: "left" | "right",
  inlineEntities: ReadonlyArray<ComposerInlineEntityDefinition> = [],
): boolean {
  const segments = splitPromptIntoComposerSegments(text, [], inlineEntities);
  if (!segments.some(isInlineTokenSegment)) {
    return false;
  }

  const cursor = clampCollapsedComposerCursorForSegments(segments, cursorInput);
  let collapsedOffset = 0;

  for (const segment of segments) {
    if (isInlineTokenSegment(segment)) {
      if (direction === "left" && cursor === collapsedOffset + 1) {
        return true;
      }
      if (direction === "right" && cursor === collapsedOffset) {
        return true;
      }
    }
    collapsedOffset += collapsedSegmentLength(segment);
  }

  return false;
}

export const isCollapsedCursorAdjacentToMention = isCollapsedCursorAdjacentToInlineToken;

export function detectComposerTrigger(
  text: string,
  cursorInput: number,
  _inlineEntities: ReadonlyArray<ComposerInlineEntityDefinition> = [],
): ComposerTrigger | null {
  const cursor = clampCursor(text, cursorInput);
  const tokenStart = tokenStartForCursor(text, cursor);
  const token = text.slice(tokenStart, cursor);
  if (token.length === 0) {
    return null;
  }

  if (token.startsWith("@")) {
    return {
      kind: "agent",
      query: token.slice(1),
      rangeStart: tokenStart,
      rangeEnd: cursor,
    };
  }

  if (token.startsWith("/")) {
    if (token.slice(1).includes("/")) {
      return null;
    }
    return {
      kind: "skill",
      query: token.slice(1),
      rangeStart: tokenStart,
      rangeEnd: cursor,
    };
  }

  return null;
}

export function replaceTextRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart));
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd));
  const nextText = `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`;
  return { text: nextText, cursor: safeStart + replacement.length };
}

export function inlineEntityDefinitionListChanged(
  previous: ReadonlyArray<ComposerInlineEntityDefinition>,
  next: ReadonlyArray<ComposerInlineEntityDefinition>,
): boolean {
  if (previous.length !== next.length) {
    return true;
  }
  return previous.some(
    (entity, index) => inlineEntityKey(entity) !== inlineEntityKey(next[index]!),
  );
}
