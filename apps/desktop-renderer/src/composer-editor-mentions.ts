import type {
  ComposerInlineEntityDefinition,
  ComposerInlineEntityKind,
} from "./composerInlineEntities";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "./lib/terminalContext";

export type ComposerPromptSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "entity";
      entityKind: ComposerInlineEntityKind;
      entityId: string;
    }
  | {
      type: "terminal-context";
      context: TerminalContextDraft | null;
    };

const INLINE_ENTITY_TOKEN_REGEX = /(^|\s)([@/])([a-z0-9][a-z0-9-]*)(?=\s)/gi;

function pushTextSegment(segments: ComposerPromptSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === "text") {
    last.text += text;
    return;
  }
  segments.push({ type: "text", text });
}

function splitPromptTextIntoComposerSegments(
  text: string,
  knownEntities: ReadonlyMap<string, ComposerInlineEntityDefinition>,
): ComposerPromptSegment[] {
  const segments: ComposerPromptSegment[] = [];
  if (!text) {
    return segments;
  }

  let cursor = 0;
  for (const match of text.matchAll(INLINE_ENTITY_TOKEN_REGEX)) {
    const fullMatch = match[0] ?? "";
    const prefix = match[1] ?? "";
    const sigil = match[2] ?? "";
    const entityId = (match[3] ?? "").toLowerCase();
    const matchIndex = match.index ?? 0;
    const mentionStart = matchIndex + prefix.length;
    const mentionEnd = mentionStart + fullMatch.length - prefix.length;
    const entity = knownEntities.get(`${sigil}${entityId}`);

    if (mentionStart > cursor) {
      pushTextSegment(segments, text.slice(cursor, mentionStart));
    }

    if (entity) {
      segments.push({
        type: "entity",
        entityKind: entity.kind,
        entityId: entity.id,
      });
    } else {
      pushTextSegment(segments, text.slice(mentionStart, mentionEnd));
    }

    cursor = mentionEnd;
  }

  if (cursor < text.length) {
    pushTextSegment(segments, text.slice(cursor));
  }

  return segments;
}

export function splitPromptIntoComposerSegments(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft> = [],
  inlineEntities: ReadonlyArray<ComposerInlineEntityDefinition> = [],
): ComposerPromptSegment[] {
  if (!prompt) {
    return [];
  }

  const segments: ComposerPromptSegment[] = [];
  const knownEntities = new Map(
    inlineEntities.map((entity) => [
      `${entity.kind === "agent" ? "@" : "/"}${entity.id}`.toLowerCase(),
      entity,
    ]),
  );
  let textCursor = 0;
  let terminalContextIndex = 0;

  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      continue;
    }

    if (index > textCursor) {
      segments.push(
        ...splitPromptTextIntoComposerSegments(prompt.slice(textCursor, index), knownEntities),
      );
    }
    segments.push({
      type: "terminal-context",
      context: terminalContexts[terminalContextIndex] ?? null,
    });
    terminalContextIndex += 1;
    textCursor = index + 1;
  }

  if (textCursor < prompt.length) {
    segments.push(...splitPromptTextIntoComposerSegments(prompt.slice(textCursor), knownEntities));
  }

  return segments;
}
