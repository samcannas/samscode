import { Effect, FileSystem, Layer, Path, ServiceMap } from "effect";
import { DEFAULT_GIT_TEXT_GENERATION_PROVIDER } from "@samscode/contracts";
import { inferProviderForModel } from "@samscode/shared/model";

import { ServerConfig } from "../../config.ts";
import { readServerSettingsWith } from "../../serverSettings.ts";
import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";

export class CodexTextGeneration extends ServiceMap.Service<
  CodexTextGeneration,
  TextGenerationShape
>()("@samscode/server/git/Layers/RoutingTextGeneration/CodexTextGeneration") {}

export class ClaudeTextGeneration extends ServiceMap.Service<
  ClaudeTextGeneration,
  TextGenerationShape
>()("@samscode/server/git/Layers/RoutingTextGeneration/ClaudeTextGeneration") {}

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  Effect.gen(function* () {
    const codexTextGeneration = yield* CodexTextGeneration;
    const claudeTextGeneration = yield* ClaudeTextGeneration;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* Effect.service(ServerConfig);
    const readServerSettings = readServerSettingsWith({
      fileSystem,
      path,
      stateDir: serverConfig.stateDir,
    });
    const resolveProvider = (model: string | undefined) =>
      readServerSettings.pipe(
        Effect.map((settings) =>
          inferProviderForModel(
            model ?? settings.textGenerationModel,
            settings.textGenerationProvider ?? DEFAULT_GIT_TEXT_GENERATION_PROVIDER,
          ),
        ),
      );

    return {
      generateCommitMessage: (input) =>
        resolveProvider(input.model).pipe(
          Effect.flatMap((provider) =>
            provider === "claudeAgent"
              ? claudeTextGeneration.generateCommitMessage(input)
              : codexTextGeneration.generateCommitMessage(input),
          ),
        ),
      generatePrContent: (input) =>
        resolveProvider(input.model).pipe(
          Effect.flatMap((provider) =>
            provider === "claudeAgent"
              ? claudeTextGeneration.generatePrContent(input)
              : codexTextGeneration.generatePrContent(input),
          ),
        ),
      generateBranchName: (input) =>
        resolveProvider(input.model).pipe(
          Effect.flatMap((provider) =>
            provider === "claudeAgent"
              ? claudeTextGeneration.generateBranchName(input)
              : codexTextGeneration.generateBranchName(input),
          ),
        ),
      cleanupTranscript: (input) =>
        resolveProvider(input.model).pipe(
          Effect.flatMap((provider) =>
            provider === "claudeAgent"
              ? claudeTextGeneration.cleanupTranscript(input)
              : codexTextGeneration.cleanupTranscript(input),
          ),
        ),
      analyzeUpstreamSync: (input) =>
        resolveProvider(input.model).pipe(
          Effect.flatMap((provider) =>
            provider === "claudeAgent"
              ? claudeTextGeneration.analyzeUpstreamSync(input)
              : codexTextGeneration.analyzeUpstreamSync(input),
          ),
        ),
    };
  }),
);
