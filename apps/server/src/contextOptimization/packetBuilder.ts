import type { OrchestrationProject, OrchestrationThread } from "@samscode/contracts";

import { CONTEXT_OPTIMIZATION_THRESHOLDS, estimateTokenCount } from "./strategy.ts";
import type {
  ContextOptimizationDurableMemory,
  ContextOptimizationPacketPreview,
  ContextOptimizationToolIndexEntry,
  ContextOptimizationWorkingSet,
} from "./types.ts";

function toAscii(value: string): string {
  let output = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isAllowed =
      code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code <= 0x7e);
    output += isAllowed ? character : "?";
  }
  return output;
}

function normalizeText(value: string | null | undefined, fallback = ""): string {
  const trimmed = (value ?? fallback).trim();
  return toAscii(trimmed);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function formatBulletLines(
  lines: ReadonlyArray<string>,
  maxItems: number,
  maxChars: number,
): string {
  return lines
    .map((line) => normalizeText(line))
    .filter((line) => line.length > 0)
    .slice(0, maxItems)
    .map((line) => `- ${truncate(line, maxChars)}`)
    .join("\n");
}

function buildRecentConversationWindow(
  workingSet: ContextOptimizationWorkingSet,
  maxTurns: number,
): string {
  return workingSet.recentTurns
    .slice(-maxTurns)
    .map((turn) => {
      const lines = [`User: ${truncate(normalizeText(turn.userText), 1_200)}`];
      if (turn.assistantText) {
        lines.push(`Assistant: ${truncate(normalizeText(turn.assistantText), 1_200)}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function buildToolFindings(toolIndex: ReadonlyArray<ContextOptimizationToolIndexEntry>): string {
  return toolIndex
    .filter((entry) => !entry.superseded)
    .slice(-6)
    .map((entry) => {
      const detail = entry.latestDetail
        ? `: ${truncate(normalizeText(entry.latestDetail), 240)}`
        : "";
      return `- ${truncate(normalizeText(entry.toolName), 80)}${detail}`;
    })
    .join("\n");
}

export function buildContextOptimizationPacket(input: {
  readonly project: OrchestrationProject | null;
  readonly thread: OrchestrationThread;
  readonly segmentIndex: number;
  readonly workingSet: ContextOptimizationWorkingSet;
  readonly durableMemory: ContextOptimizationDurableMemory;
  readonly toolIndex: ReadonlyArray<ContextOptimizationToolIndexEntry>;
}): ContextOptimizationPacketPreview {
  const sections = [
    "You are continuing an existing coding thread after an internal context optimization.",
    "Treat the following as authoritative working context for this same user-visible thread.",
    "",
    "<thread-context>",
    `Thread title: ${truncate(normalizeText(input.thread.title), 400)}`,
    `Project root: ${truncate(normalizeText(input.project?.workspaceRoot ?? input.durableMemory.workspaceRoot), 400)}`,
    `Branch/worktree: ${truncate(normalizeText([input.thread.branch, input.thread.worktreePath].filter(Boolean).join(" | "), "unknown"), 400)}`,
    `Provider/model continuity: ${truncate(normalizeText([input.durableMemory.provider, input.durableMemory.model].filter(Boolean).join(" / "), "unknown"), 240)}`,
    `Interaction mode: ${truncate(normalizeText(input.thread.interactionMode), 120)}`,
    `Optimization segment: ${input.segmentIndex + 1}`,
    "</thread-context>",
    "",
    "<current-objective>",
    truncate(normalizeText(input.durableMemory.currentObjective), 2_000),
    "</current-objective>",
    "",
    "<constraints-and-preferences>",
    formatBulletLines(input.durableMemory.constraints, 8, 240),
    "</constraints-and-preferences>",
    "",
    "<active-plan>",
    truncate(normalizeText(input.workingSet.activePlan ?? input.durableMemory.acceptedPlan), 2_000),
    "</active-plan>",
    "",
    "<durable-findings>",
    [formatBulletLines(input.durableMemory.findings, 8, 240), buildToolFindings(input.toolIndex)]
      .filter((value) => value.trim().length > 0)
      .join("\n"),
    "</durable-findings>",
    "",
    "<recent-changes>",
    [input.workingSet.latestCheckpointSummary, ...input.durableMemory.recentChanges]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .slice(0, 6)
      .map((line) => `- ${truncate(normalizeText(line), 240)}`)
      .join("\n"),
    "</recent-changes>",
    "",
    "<important-open-issues>",
    formatBulletLines(
      [...input.workingSet.unresolvedIssues, ...input.durableMemory.unresolvedFailures],
      8,
      240,
    ),
    "</important-open-issues>",
    "",
    "<recent-conversation-window>",
    buildRecentConversationWindow(input.workingSet, 3),
    "</recent-conversation-window>",
    "",
    "Continue seamlessly from this state. Do not mention the optimization unless the user asks.",
  ];

  let text = sections
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > CONTEXT_OPTIMIZATION_THRESHOLDS.hardPacketCharCap) {
    text = truncate(text, CONTEXT_OPTIMIZATION_THRESHOLDS.hardPacketCharCap);
  }

  return {
    text,
    charCount: text.length,
    estimatedTokens: estimateTokenCount(text),
  };
}

export function buildReseedProviderInput(packet: string, userMessageText: string): string {
  const normalizedUserMessage = truncate(normalizeText(userMessageText), 12_000);
  return `${packet}\n\n<latest-user-message>\n${normalizedUserMessage}\n</latest-user-message>`;
}
