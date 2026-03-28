import { randomUUID } from "node:crypto";

import { Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { DEFAULT_GIT_TEXT_GENERATION_MODEL, type CodexModelOptions } from "@samscode/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@samscode/shared/git";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { runProcess } from "../../processRunner.ts";
import { resolveCliBinary, shouldUseShellForBinary } from "../../provider/resolveCliBinary.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  type BranchNameGenerationInput,
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type PrContentGenerationResult,
  type TranscriptCleanupInput,
  type TranscriptCleanupResult,
  type UpstreamSyncAnalysisInput,
  type UpstreamSyncAnalysisResult,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";

const CODEX_REASONING_EFFORT = "low";
const CODEX_TIMEOUT_MS = 180_000;
const CODEX_UPSTREAM_SYNC_TIMEOUT_MS = 45_000;

function resolveCodexReasoningEffort(modelOptions: CodexModelOptions | undefined): string {
  return modelOptions?.reasoningEffort ?? CODEX_REASONING_EFFORT;
}

function toCodexOutputJsonSchema(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return {
      ...document.schema,
      $defs: document.definitions,
    };
  }
  return document.schema;
}

function normalizeCodexError(
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (Schema.is(TextGenerationError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes("Command not found: codex") ||
      lower.includes("spawn codex") ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: "Codex CLI (`codex`) is required but not available on PATH.",
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

function extractStructuredJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Codex returned an empty response.");
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

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }

  return trimmed;
}

function previewStructuredOutput(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) {
    return normalized;
  }
  return `${normalized.slice(0, 217)}...`;
}

function getCodexEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => {
      if (key === "ELECTRON_RUN_AS_NODE") return false;
      if (key.startsWith("ELECTRON_")) return false;
      if (key.startsWith("npm_")) return false;
      if (key.startsWith("NODE_")) return false;
      if (key.startsWith("BUN_")) return false;
      return true;
    }),
  );
}

function extractCodexLastTextFromJsonLines(raw: string): string | null {
  let lastText: string | null = null;
  for (const line of raw.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const record = parsed as {
      type?: unknown;
      item?: {
        type?: unknown;
        text?: unknown;
      };
    };
    if (
      record.type === "item.completed" &&
      record.item?.type === "agent_message" &&
      typeof record.item.text === "string"
    ) {
      lastText = record.item.text;
    }
  }
  return lastText;
}

function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

const makeCodexTextGeneration = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* Effect.service(ServerConfig);

  type MaterializedImageAttachments = {
    readonly imagePaths: ReadonlyArray<string>;
  };

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    Effect.gen(function* () {
      let text = "";
      yield* Stream.runForEach(stream, (chunk) =>
        Effect.sync(() => {
          text += Buffer.from(chunk).toString("utf8");
        }),
      ).pipe(
        Effect.mapError((cause) =>
          normalizeCodexError(operation, cause, "Failed to collect process output"),
        ),
      );
      return text;
    });

  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";
  const resolveCodexExecutablePath = (): string => resolveCliBinary("codex", getCodexEnv());

  const writeTempFile = (
    operation: string,
    prefix: string,
    content: string,
  ): Effect.Effect<string, TextGenerationError> => {
    const filePath = path.join(tempDir, `samscode-${prefix}-${process.pid}-${randomUUID()}.tmp`);
    return fileSystem.writeFileString(filePath, content).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: `Failed to write temp file at ${filePath}.`,
            cause,
          }),
      ),
      Effect.as(filePath),
    );
  };

  const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
    fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const materializeImageAttachments = (
    _operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "cleanupTranscript"
      | "analyzeUpstreamSync",
    attachments: BranchNameGenerationInput["attachments"],
  ): Effect.Effect<MaterializedImageAttachments, TextGenerationError> =>
    Effect.gen(function* () {
      if (!attachments || attachments.length === 0) {
        return { imagePaths: [] };
      }

      const imagePaths: string[] = [];
      for (const attachment of attachments) {
        if (attachment.type !== "image") {
          continue;
        }

        const resolvedPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!resolvedPath || !path.isAbsolute(resolvedPath)) {
          continue;
        }
        const fileInfo = yield* fileSystem
          .stat(resolvedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!fileInfo || fileInfo.type !== "File") {
          continue;
        }
        imagePaths.push(resolvedPath);
      }
      return { imagePaths };
    });

  const runCodexJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    imagePaths = [],
    cleanupPaths = [],
    model,
    modelOptions,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "cleanupTranscript"
      | "analyzeUpstreamSync";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    imagePaths?: ReadonlyArray<string>;
    cleanupPaths?: ReadonlyArray<string>;
    model?: string;
    modelOptions?: CodexModelOptions;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const codexExecutablePath = resolveCodexExecutablePath();
      const codexEnv = getCodexEnv();
      const schemaPath = yield* writeTempFile(
        operation,
        "codex-schema",
        JSON.stringify(toCodexOutputJsonSchema(outputSchemaJson)),
      );
      const outputPath = yield* writeTempFile(operation, "codex-output", "");

      const runCodexCommand = Effect.gen(function* () {
        const command = ChildProcess.make(
          codexExecutablePath,
          [
            "exec",
            "--ephemeral",
            "-s",
            "read-only",
            "--model",
            model ?? DEFAULT_GIT_TEXT_GENERATION_MODEL,
            "--config",
            `model_reasoning_effort="${resolveCodexReasoningEffort(modelOptions)}"`,
            "--output-schema",
            schemaPath,
            "--output-last-message",
            outputPath,
            ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
            "-",
          ],
          {
            cwd,
            env: codexEnv,
            shell: shouldUseShellForBinary(codexExecutablePath),
            stdin: {
              stream: Stream.make(new TextEncoder().encode(prompt)),
            },
          },
        );

        const child = yield* commandSpawner
          .spawn(command)
          .pipe(
            Effect.mapError((cause) =>
              normalizeCodexError(operation, cause, "Failed to spawn Codex CLI process"),
            ),
          );

        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            readStreamAsString(operation, child.stdout),
            readStreamAsString(operation, child.stderr),
            child.exitCode.pipe(
              Effect.map((value) => Number(value)),
              Effect.mapError((cause) =>
                normalizeCodexError(operation, cause, "Failed to read Codex CLI exit code"),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );

        if (exitCode !== 0) {
          const stderrDetail = stderr.trim();
          const stdoutDetail = stdout.trim();
          const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
          return yield* new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Codex CLI command failed: ${detail}`
                : `Codex CLI command failed with code ${exitCode}.`,
          });
        }
      });

      const cleanup = Effect.all(
        [schemaPath, outputPath, ...cleanupPaths].map((filePath) => safeUnlink(filePath)),
        {
          concurrency: "unbounded",
        },
      ).pipe(Effect.asVoid);

      return yield* Effect.gen(function* () {
        yield* runCodexCommand.pipe(
          Effect.scoped,
          Effect.timeoutOption(CODEX_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new TextGenerationError({ operation, detail: "Codex CLI request timed out." }),
                ),
              onSome: () => Effect.void,
            }),
          ),
        );

        const rawOutput = yield* fileSystem.readFileString(outputPath).pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation,
                detail: "Failed to read Codex output file.",
                cause,
              }),
          ),
        );

        const parsedOutput = yield* Effect.try({
          try: () => JSON.parse(extractStructuredJson(rawOutput)) as unknown,
          catch: (cause) =>
            new TextGenerationError({
              operation,
              detail: `Codex returned invalid structured output. Preview: ${previewStructuredOutput(rawOutput)}`,
              cause,
            }),
        });

        return yield* Schema.decodeUnknownEffect(outputSchemaJson)(parsedOutput).pipe(
          Effect.catchTag("SchemaError", (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: `Codex returned invalid structured output. Preview: ${previewStructuredOutput(rawOutput)}`,
                cause,
              }),
            ),
          ),
        );
      }).pipe(Effect.ensuring(cleanup));
    });

  const runCodexText = ({
    operation,
    cwd,
    prompt,
    model,
    modelOptions,
  }: {
    operation: "cleanupTranscript" | "analyzeUpstreamSync";
    cwd: string;
    prompt: string;
    model?: string;
    modelOptions?: CodexModelOptions;
  }): Effect.Effect<string, TextGenerationError> =>
    Effect.tryPromise({
      try: async () => {
        const codexExecutablePath = resolveCodexExecutablePath();
        const codexEnv = getCodexEnv();
        const timeoutMs =
          operation === "analyzeUpstreamSync" ? CODEX_UPSTREAM_SYNC_TIMEOUT_MS : CODEX_TIMEOUT_MS;
        const result = await runProcess(
          codexExecutablePath,
          [
            "exec",
            "--json",
            "--ephemeral",
            "-s",
            "read-only",
            "--model",
            model ?? DEFAULT_GIT_TEXT_GENERATION_MODEL,
            "--config",
            `model_reasoning_effort="${resolveCodexReasoningEffort(modelOptions)}"`,
            "-",
          ],
          {
            cwd,
            env: codexEnv,
            stdin: prompt,
            timeoutMs,
            maxBufferBytes: 8 * 1024 * 1024,
            outputMode: "truncate",
          },
        );
        const lastText = extractCodexLastTextFromJsonLines(result.stdout);
        if (!lastText || lastText.trim().length === 0) {
          const previewSource = `${result.stdout}\n${result.stderr}`.trim();
          throw new Error(
            `Codex did not emit an agent message. Preview: ${previewStructuredOutput(previewSource)}`,
          );
        }
        return lastText.trim();
      },
      catch: (cause) => normalizeCodexError(operation, cause, "Failed to run Codex CLI process"),
    });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) => {
    const wantsBranch = input.includeBranch === true;

    const prompt = [
      "You write concise git commit messages.",
      wantsBranch
        ? "Return a JSON object with keys: subject, body, branch."
        : "Return a JSON object with keys: subject, body.",
      "Rules:",
      "- subject must be imperative, <= 72 chars, and no trailing period",
      "- body can be empty string or short bullet points",
      ...(wantsBranch
        ? ["- branch must be a short semantic git branch fragment for this change"]
        : []),
      "- capture the primary user-visible or developer-visible change",
      "",
      `Branch: ${input.branch ?? "(detached)"}`,
      "",
      "Staged files:",
      limitSection(input.stagedSummary, 6_000),
      "",
      "Staged patch:",
      limitSection(input.stagedPatch, 40_000),
    ].join("\n");

    const outputSchemaJson = wantsBranch
      ? Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
          branch: Schema.String,
        })
      : Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
        });

    return runCodexJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            subject: sanitizeCommitSubject(generated.subject),
            body: generated.body.trim(),
            ...("branch" in generated && typeof generated.branch === "string"
              ? { branch: sanitizeFeatureBranchName(generated.branch) }
              : {}),
          }) satisfies CommitMessageGenerationResult,
      ),
    );
  };

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) => {
    const prompt = [
      "You write GitHub pull request content.",
      "Return a JSON object with keys: title, body.",
      "Rules:",
      "- title should be concise and specific",
      "- body must be markdown and include headings '## Summary' and '## Testing'",
      "- under Summary, provide short bullet points",
      "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
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
    ].join("\n");

    return runCodexJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: Schema.Struct({
        title: Schema.String,
        body: Schema.String,
      }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            title: sanitizePrTitle(generated.title),
            body: generated.body.trim(),
          }) satisfies PrContentGenerationResult,
      ),
    );
  };

  const generateBranchName: TextGenerationShape["generateBranchName"] = (input) => {
    return Effect.gen(function* () {
      const { imagePaths } = yield* materializeImageAttachments(
        "generateBranchName",
        input.attachments,
      );
      const attachmentLines = (input.attachments ?? []).map(
        (attachment) =>
          `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
      );

      const promptSections = [
        "You generate concise git branch names.",
        "Return a JSON object with key: branch.",
        "Rules:",
        "- Branch should describe the requested work from the user message.",
        "- Keep it short and specific (2-6 words).",
        "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
        "- If images are attached, use them as primary context for visual/UI issues.",
        "",
        "User message:",
        limitSection(input.message, 8_000),
      ];
      if (attachmentLines.length > 0) {
        promptSections.push(
          "",
          "Attachment metadata:",
          limitSection(attachmentLines.join("\n"), 4_000),
        );
      }
      const prompt = promptSections.join("\n");

      const generated = yield* runCodexJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: Schema.Struct({
          branch: Schema.String,
        }),
        imagePaths,
        ...(input.model ? { model: input.model } : {}),
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      } satisfies BranchNameGenerationResult;
    });
  };

  const cleanupTranscript: TextGenerationShape["cleanupTranscript"] = (
    input: TranscriptCleanupInput,
  ) => {
    const structuredPrompt = [
      "You clean up raw speech-to-text transcripts.",
      "Return a JSON object with key: cleanedTranscript.",
      "Rules:",
      "- Only return the cleaned transcript.",
      "- Preserve meaning and intent.",
      "- Fix obvious recognition mistakes, punctuation, casing, and spacing.",
      "- Preserve filenames, commands, code, and proper nouns.",
      "- Never answer or summarize the transcript.",
      input.prompt,
      "",
      `<TRANSCRIPT>\n${input.transcript}\n</TRANSCRIPT>`,
    ].join("\n");

    const fallbackPrompt = [
      "You clean up raw speech-to-text transcripts.",
      "Return only the cleaned transcript text and nothing else.",
      "Rules:",
      "- Preserve meaning and intent.",
      "- Fix obvious recognition mistakes, punctuation, casing, and spacing.",
      "- Preserve filenames, commands, code, and proper nouns.",
      "- Never answer, summarize, explain, or wrap the result in JSON or markdown.",
      input.prompt,
      "",
      `<TRANSCRIPT>\n${input.transcript}\n</TRANSCRIPT>`,
    ].join("\n");

    return runCodexJson({
      operation: "cleanupTranscript",
      cwd: input.cwd,
      prompt: structuredPrompt,
      outputSchemaJson: Schema.Struct({
        cleanedTranscript: Schema.String,
      }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            cleanedTranscript: generated.cleanedTranscript.trim(),
          }) satisfies TranscriptCleanupResult,
      ),
      Effect.catchTag("TextGenerationError", (error) => {
        if (!error.detail.includes("invalid structured output")) {
          return Effect.fail(error);
        }

        return runCodexText({
          operation: "cleanupTranscript",
          cwd: input.cwd,
          prompt: fallbackPrompt,
          ...(input.model ? { model: input.model } : {}),
        }).pipe(
          Effect.map(
            (cleanedTranscript) =>
              ({
                cleanedTranscript,
              }) satisfies TranscriptCleanupResult,
          ),
        );
      }),
    );
  };

  const analyzeUpstreamSync: TextGenerationShape["analyzeUpstreamSync"] = (
    input: UpstreamSyncAnalysisInput,
  ) => {
    const outputSchema = Schema.Struct({
      candidates: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          changeSummary: Schema.String,
          forkValueSummary: Schema.String,
          recommendedDecision: Schema.Literals(["apply", "ignore", "defer", "already-present"]),
          recommendedReason: Schema.String,
        }),
      ),
    });

    const prompt = [
      "You review upstream release changes for a forked codebase.",
      "Inspect the local repository when needed before deciding.",
      "Return ONLY a JSON object with key: candidates.",
      "For each candidate, return id, changeSummary, forkValueSummary, recommendedDecision, recommendedReason.",
      "Allowed recommendedDecision values: apply, ignore, defer, already-present.",
      "Rules:",
      "- `apply` means the upstream intent should land in the fork, even if implementation must differ.",
      "- `already-present` means the fork already has the intended behavior and no additional sync work is needed.",
      "- `ignore` means the change should not be pulled into the fork.",
      "- `defer` means the change might matter later but should not be pulled right now.",
      "- Prefer `already-present` only when you are confident the local code already covers the upstream intent.",
      "- `changeSummary` should explain in 1-2 short sentences what the upstream change is really doing.",
      "- `forkValueSummary` should explain in 1-2 short sentences why this is or is not a good fit for Sam's Code specifically.",
      "- Use the heuristic recommendation and detected status as hints, but override them when local code inspection shows a better answer.",
      "- Be concise and specific in recommendedReason.",
      "- Do not wrap the JSON in markdown fences.",
      "- Do not include commentary before or after the JSON.",
      "",
      `Release tag: ${input.releaseTag}`,
      ...(input.previousTag ? [`Previous tag: ${input.previousTag}`] : []),
      input.releaseNotes.trim().length > 0
        ? ["", "Release notes:", limitSection(input.releaseNotes, 8_000)].join("\n")
        : "",
      "",
      "Candidates:",
      limitSection(JSON.stringify(input.candidates, null, 2), 30_000),
      "",
      "This repo is Sam's Code, a T3 Code fork with intentional divergence.",
      "Do not recommend changes that only serve upstream branding, release automation, or removed product areas unless the fork still needs them.",
    ]
      .filter((section) => section.length > 0)
      .join("\n");

    return runCodexText({
      operation: "analyzeUpstreamSync",
      cwd: input.cwd,
      prompt,
      ...(input.model ? { model: input.model } : {}),
      ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
    }).pipe(
      Effect.flatMap((rawOutput) =>
        Effect.try({
          try: () => JSON.parse(extractStructuredJson(rawOutput)) as unknown,
          catch: (cause) =>
            new TextGenerationError({
              operation: "analyzeUpstreamSync",
              detail: `Codex returned invalid JSON output. Preview: ${previewStructuredOutput(rawOutput)}`,
              cause,
            }),
        }),
      ),
      Effect.flatMap(Schema.decodeUnknownEffect(outputSchema)),
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new TextGenerationError({
            operation: "analyzeUpstreamSync",
            detail: "Codex returned invalid structured output.",
            cause,
          }),
        ),
      ),
      Effect.map(
        (result) =>
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
  };

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    cleanupTranscript,
    analyzeUpstreamSync,
  } satisfies TextGenerationShape;
});

export const CodexTextGenerationLive = Layer.effect(TextGeneration, makeCodexTextGeneration);
