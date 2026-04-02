import {
  query,
  type Options as ClaudeQueryOptions,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL, type ClaudeModelOptions } from "@samscode/contracts";
import {
  applyClaudePromptEffortPrefix,
  getEffectiveClaudeCodeEffort,
  getReasoningEffortOptions,
  resolveClaudeApiModel,
  resolveReasoningEffortForProvider,
} from "@samscode/shared/model";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

import { ServerConfig } from "../../config.ts";
import { readServerSettingsWith } from "../../serverSettings.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  type TextGenerationShape,
  TextGeneration,
  type UpstreamSyncAnalysisResult,
} from "../Services/TextGeneration.ts";

function buildClaudeUserMessage(prompt: string): SDKUserMessage {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  } as SDKUserMessage;
}

function extractAssistantText(message: SDKMessage): string {
  if (message.type !== "assistant" || !Array.isArray(message.message?.content)) {
    return "";
  }
  return message.message.content
    .map((block: unknown) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractStructuredJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Claude returned an empty response.");
  }
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }
  return trimmed;
}

function previewStructuredOutput(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }
  return withoutTrailingPeriod.length <= 72
    ? withoutTrailingPeriod
    : withoutTrailingPeriod.slice(0, 72).trimEnd();
}

function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  return singleLine.length > 0 ? singleLine : "Update project changes";
}

const makeClaudeTextGeneration = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* Effect.service(ServerConfig);
  const readServerSettings = readServerSettingsWith({
    fileSystem,
    path,
    stateDir: serverConfig.stateDir,
  });

  const runClaude = <S extends Schema.Top & { readonly DecodingServices: never }>(input: {
    readonly operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "cleanupTranscript"
      | "analyzeUpstreamSync";
    readonly cwd: string;
    readonly prompt: string;
    readonly schema: S;
    readonly model?: string;
    readonly modelOptions?: ClaudeModelOptions;
  }): Effect.Effect<S["Type"], TextGenerationError> =>
    Effect.gen(function* () {
      const settings = yield* readServerSettings;
      const logicalModel = input.model ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
      const requestedEffort = resolveReasoningEffortForProvider(
        "claudeAgent",
        input.modelOptions?.effort ?? null,
      );
      const supportedEffortOptions = getReasoningEffortOptions("claudeAgent", logicalModel);
      const effectiveEffort =
        requestedEffort && supportedEffortOptions.includes(requestedEffort)
          ? getEffectiveClaudeCodeEffort(requestedEffort)
          : null;
      const queryOptions: ClaudeQueryOptions = {
        cwd: input.cwd,
        model: resolveClaudeApiModel(logicalModel, input.modelOptions),
        pathToClaudeCodeExecutable: settings.claudeBinaryPath ?? "claude",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: false,
        env: process.env,
        additionalDirectories: [input.cwd],
        ...(effectiveEffort ? { effort: effectiveEffort } : {}),
        ...(input.modelOptions?.thinking !== undefined
          ? {
              settings: {
                alwaysThinkingEnabled: input.modelOptions.thinking,
              },
            }
          : {}),
      };
      let latestAssistantText = "";

      yield* Effect.tryPromise({
        try: async () => {
          for await (const message of query({
            prompt: (async function* () {
              yield buildClaudeUserMessage(
                applyClaudePromptEffortPrefix(input.prompt, requestedEffort ?? null),
              );
            })(),
            options: queryOptions,
          })) {
            const assistantText = extractAssistantText(message);
            if (assistantText.length > 0) {
              latestAssistantText = assistantText;
            }
            if (message.type === "result" && message.subtype !== "success") {
              throw new Error(message.errors[0] ?? `Claude ${input.operation} failed.`);
            }
          }
        },
        catch: (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: cause instanceof Error ? cause.message : `Claude ${input.operation} failed.`,
            cause,
          }),
      });

      const parsed = yield* Effect.try({
        try: () => JSON.parse(extractStructuredJson(latestAssistantText)) as unknown,
        catch: (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: `Claude returned invalid structured output. Preview: ${previewStructuredOutput(latestAssistantText)}`,
            cause,
          }),
      });

      return yield* Effect.try({
        try: () => Schema.decodeUnknownSync(input.schema)(parsed),
        catch: (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: `Claude returned invalid structured output. Preview: ${previewStructuredOutput(latestAssistantText)}`,
            cause,
          }),
      });
    });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) =>
    runClaude({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt: [
        "You write concise git commit messages.",
        input.includeBranch === true
          ? "Return a JSON object with keys: subject, body, branch."
          : "Return a JSON object with keys: subject, body.",
        "Rules:",
        "- subject must be imperative, <= 72 chars, and no trailing period",
        "- body can be empty string or short bullet points",
        ...(input.includeBranch === true
          ? ["- branch must be a short semantic git branch fragment for this change"]
          : []),
        "",
        `Branch: ${input.branch ?? "(detached)"}`,
        "",
        "Staged files:",
        limitSection(input.stagedSummary, 6_000),
        "",
        "Staged patch:",
        limitSection(input.stagedPatch, 40_000),
      ].join("\n"),
      schema:
        input.includeBranch === true
          ? Schema.Struct({ subject: Schema.String, body: Schema.String, branch: Schema.String })
          : Schema.Struct({ subject: Schema.String, body: Schema.String }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map((generated: { subject: string; body: string; branch?: string }) => ({
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...(generated.branch ? { branch: generated.branch.trim() } : {}),
      })),
    );

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) =>
    runClaude({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt: [
        "You write GitHub pull request content.",
        "Return a JSON object with keys: title, body.",
        "Rules:",
        "- title should be concise and specific",
        "- body must be markdown and include headings '## Summary' and '## Testing'",
        "",
        `Base branch: ${input.baseBranch}`,
        `Head branch: ${input.headBranch}`,
        "",
        "Commits:",
        limitSection(input.commitSummary, 12_000),
        "",
        "Diff stat:",
        limitSection(input.diffSummary, 12_000),
        "",
        "Diff patch:",
        limitSection(input.diffPatch, 40_000),
      ].join("\n"),
      schema: Schema.Struct({ title: Schema.String, body: Schema.String }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map((generated: { title: string; body: string }) => ({
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      })),
    );

  const generateBranchName: TextGenerationShape["generateBranchName"] = (input) =>
    runClaude({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt: [
        "You generate concise git branch names.",
        "Return a JSON object with key: branch.",
        "Rules:",
        "- Keep it short and specific.",
        "- Use plain words only.",
        "",
        "User message:",
        limitSection(input.message, 8_000),
      ].join("\n"),
      schema: Schema.Struct({ branch: Schema.String }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map((generated: { branch: string }) => ({
        branch: generated.branch.trim(),
      })),
    );

  const cleanupTranscript: TextGenerationShape["cleanupTranscript"] = (input) =>
    runClaude({
      operation: "cleanupTranscript",
      cwd: input.cwd,
      prompt: [
        "You clean up raw speech-to-text transcripts.",
        "Return a JSON object with key: cleanedTranscript.",
        "Rules:",
        "- Only return the cleaned transcript.",
        "- Preserve meaning and intent.",
        "- Fix obvious recognition mistakes, punctuation, casing, and spacing.",
        input.prompt,
        "",
        `<TRANSCRIPT>\n${input.transcript}\n</TRANSCRIPT>`,
      ].join("\n"),
      schema: Schema.Struct({ cleanedTranscript: Schema.String }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map((generated: { cleanedTranscript: string }) => ({
        cleanedTranscript: generated.cleanedTranscript.trim(),
      })),
    );

  const analyzeUpstreamSync: TextGenerationShape["analyzeUpstreamSync"] = (input) =>
    runClaude({
      operation: "analyzeUpstreamSync",
      cwd: input.cwd,
      prompt: [
        "You review upstream release changes for a forked codebase.",
        "Return ONLY a JSON object with key: candidates.",
        `Release tag: ${input.releaseTag}`,
        ...(input.previousTag ? [`Previous tag: ${input.previousTag}`] : []),
        "",
        "Candidates:",
        limitSection(JSON.stringify(input.candidates, null, 2), 30_000),
      ].join("\n"),
      schema: Schema.Struct({
        candidates: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            changeSummary: Schema.String,
            forkValueSummary: Schema.String,
            recommendedDecision: Schema.Literals(["apply", "ignore", "defer", "already-present"]),
            recommendedReason: Schema.String,
          }),
        ),
      }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (result: UpstreamSyncAnalysisResult) =>
          ({
            candidates: result.candidates.map((candidate) => ({
              id: candidate.id.trim(),
              changeSummary: candidate.changeSummary.trim(),
              forkValueSummary: candidate.forkValueSummary.trim(),
              recommendedDecision: candidate.recommendedDecision,
              recommendedReason: candidate.recommendedReason.trim(),
            })),
          }) satisfies UpstreamSyncAnalysisResult,
      ),
    );

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    cleanupTranscript,
    analyzeUpstreamSync,
  } satisfies TextGenerationShape;
});

export const ClaudeTextGenerationLive = Layer.effect(TextGeneration, makeClaudeTextGeneration);
