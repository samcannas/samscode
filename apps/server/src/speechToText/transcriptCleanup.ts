import { Effect } from "effect";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL } from "@samscode/contracts";
import { inferProviderForModel } from "@samscode/shared/model";

import type { TextGenerationShape } from "../git/Services/TextGeneration";
import { cleanupTranscriptWithClaude } from "./claudeTranscriptCleanup";
import {
  buildTranscriptCleanupPrompt,
  shouldSkipTranscriptCleanup,
} from "./transcriptCleanupPrompt";

function filterCleanupOutput(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function cleanupTranscriptWithLlm(input: {
  readonly textGeneration: TextGenerationShape;
  readonly cwd: string;
  readonly transcript: string;
  readonly language: string;
  readonly prompt: string;
  readonly model?: string | undefined;
}): Promise<{
  cleanedTranscript: string;
  cleanupBackend: "codex" | "claudeAgent";
  cleanupModel: string | null;
}> {
  const transcript = input.transcript.trim();
  const model = input.model ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
  const provider = inferProviderForModel(model, "codex");
  if (transcript.length === 0 || shouldSkipTranscriptCleanup(transcript)) {
    return {
      cleanedTranscript: transcript,
      cleanupBackend: provider,
      cleanupModel: model,
    };
  }

  const cleanupPrompt = buildTranscriptCleanupPrompt({
    language: input.language,
    prompt: input.prompt,
  });

  const cleanedTranscript =
    provider === "claudeAgent"
      ? await cleanupTranscriptWithClaude({
          cwd: input.cwd,
          prompt: cleanupPrompt,
          model,
        })
      : (
          await Effect.runPromise(
            input.textGeneration.cleanupTranscript({
              cwd: input.cwd,
              transcript,
              prompt: cleanupPrompt,
              language: input.language,
              model,
            }),
          )
        ).cleanedTranscript;

  return {
    cleanedTranscript: filterCleanupOutput(cleanedTranscript),
    cleanupBackend: provider,
    cleanupModel: model,
  };
}
