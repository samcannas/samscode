import os from "node:os";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  SpeechToTextInstalledModel,
  SpeechToTextSessionEvent,
  SpeechToTextSessionFinalEvent,
  SpeechToTextSessionSegmentCommittedEvent,
  SpeechToTextSessionStartedEvent,
  SpeechToTextSessionPartialEvent,
  SpeechToTextAudioChunk,
  SpeechToTextSettings,
  SpeechToTextState,
} from "@samscode/contracts";
import { Effect, PubSub, ServiceMap, Stream } from "effect";

import { ServerConfig } from "../config";
import {
  DEFAULT_ENGLISH_SPEECH_TO_TEXT_MODEL_ID,
  DEFAULT_MULTILINGUAL_SPEECH_TO_TEXT_MODEL_ID,
  getSpeechToTextCatalogEntry,
  resolveSpeechToTextModelDownloadUrl,
  SPEECH_TO_TEXT_MODEL_CATALOG,
} from "./catalog";
import { createSpeechToTextConfigStore } from "./configStore";
import {
  PREVIEW_INTERVAL_MS,
  PREVIEW_MIN_AUDIO_MS,
  isSpeechChunk,
  MIN_SPEECH_MS,
} from "./endpointing";
import { downloadFileToPath } from "./downloadManager";
import { calculateChunkRms, createWavBufferFromPcmChunks, decodePcmBase64 } from "./pcmWav";
import { ensureVadModelInstalled } from "./resources";
import {
  buildRuntimeArchiveTempPath,
  ensureRuntimeBinaryPermissions,
  extractRuntimeArchive,
  isRuntimeInstallationCompatible,
  resolveInstalledRuntimeBinaryPath,
  resolveRuntimePlatformTarget,
  resolveRuntimeReleaseAsset,
  resolveSpeechToTextPaths,
  writeRuntimeInstallationMetadata,
} from "./runtimeResolver";
import type {
  SpeechToTextConfigRecord,
  SpeechToTextMutableState,
  SpeechToTextResolvedResources,
  SpeechToTextSessionRecord,
  SpeechToTextShape,
} from "./types";
import { createWhisperSidecarManager, resolveWhisperSidecarBinaryName } from "./whisperSidecar";

export class SpeechToText extends ServiceMap.Service<SpeechToText, SpeechToTextShape>()(
  "samscode/speechToText/service/SpeechToText",
) {}

interface AsyncMutex {
  run<T>(task: () => Promise<T>): Promise<T>;
}

function createAsyncMutex(): AsyncMutex {
  let tail = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(task, task);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

function isLoopbackHost(host: string | undefined): boolean {
  return host === undefined || host === "127.0.0.1" || host === "localhost" || host === "::1";
}

async function fileExists(candidatePath: string): Promise<boolean> {
  return (await fs.stat(candidatePath).catch(() => null))?.isFile() ?? false;
}

async function listInstalledModels(
  modelsDir: string,
  selectedModelId: string | null,
): Promise<SpeechToTextInstalledModel[]> {
  const installedModels = await Promise.all(
    SPEECH_TO_TEXT_MODEL_CATALOG.map(async (entry) => {
      const installedPath = path.join(modelsDir, entry.fileName);
      const stat = await fs.stat(installedPath).catch(() => null);
      if (!stat?.isFile()) {
        return null;
      }
      return {
        id: entry.id,
        fileName: entry.fileName,
        name: entry.name,
        sizeBytes: stat.size,
        installedAt: stat.mtime.toISOString(),
        selected: selectedModelId === entry.id,
      } satisfies SpeechToTextInstalledModel;
    }),
  );

  return installedModels.filter((entry): entry is SpeechToTextInstalledModel => entry !== null);
}

async function removeMatchingTemporaryEntries(directoryPath: string): Promise<void> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.name.includes(".tmp") || entry.name.endsWith(".download"))
      .map((entry) =>
        fs.rm(path.join(directoryPath, entry.name), { recursive: true, force: true }),
      ),
  );
}

function normalizeWhisperCliErrorMessage(message: string, modelName: string): string {
  if (message.includes("GGML_ASSERT(ctx->mem_buffer != NULL)")) {
    return `whisper.cpp could not allocate enough memory for ${modelName}. Try a smaller speech-to-text model, or repair the runtime if this install came from an earlier build.`;
  }
  return message;
}

function resolvePreferredInstalledModelId(input: {
  installedModels: ReadonlyArray<SpeechToTextInstalledModel>;
  settings: SpeechToTextSettings;
}): string | null {
  if (input.installedModels.length === 0) {
    return null;
  }

  const preferredId =
    input.settings.language === "en"
      ? input.settings.qualityProfile === "fast"
        ? "ggml-base.en.bin"
        : input.settings.qualityProfile === "quality"
          ? "ggml-large-v3.bin"
          : DEFAULT_ENGLISH_SPEECH_TO_TEXT_MODEL_ID
      : input.settings.qualityProfile === "fast"
        ? "ggml-base.bin"
        : input.settings.qualityProfile === "quality"
          ? "ggml-large-v3.bin"
          : DEFAULT_MULTILINGUAL_SPEECH_TO_TEXT_MODEL_ID;
  if (input.installedModels.some((entry) => entry.id === preferredId)) {
    return preferredId;
  }

  const recommended = input.installedModels.find(
    (entry) =>
      SPEECH_TO_TEXT_MODEL_CATALOG.find((catalogEntry) => catalogEntry.id === entry.id)
        ?.recommended,
  );
  return recommended?.id ?? input.installedModels[0]?.id ?? null;
}

function getLanguageForModel(settings: SpeechToTextSettings, modelId: string): string {
  const model = getSpeechToTextCatalogEntry(modelId);
  if (!model) {
    return settings.language;
  }
  if (model.language === "english" && settings.language === "auto") {
    return "en";
  }
  return settings.language;
}

function getPromptForSettings(settings: SpeechToTextSettings): string {
  return settings.prompt.trim();
}

function getDefaultDecodeThreads(): number {
  const available = os.availableParallelism?.() ?? 4;
  return Math.max(1, Math.min(available > 2 ? available - 1 : available, 8));
}

function supportsLivePartialPreview(modelId: string | null): boolean {
  if (!modelId) {
    return false;
  }
  const model = getSpeechToTextCatalogEntry(modelId);
  if (!model) {
    return false;
  }
  return model.sizeBytes <= 250 * 1024 * 1024;
}

function shouldUseSidecarVad(settings: SpeechToTextSettings): boolean {
  return settings.useVad && !settings.endpointingEnabled;
}

function createFinalMetrics(input: { session: SpeechToTextSessionRecord; decodeMs: number }) {
  return {
    recordedAudioMs: input.session.totalAudioMs,
    transportDrainMs:
      input.session.stopRequestedAtMs !== null && input.session.lastAppendCompletedAtMs !== null
        ? Math.max(0, input.session.lastAppendCompletedAtMs - input.session.stopRequestedAtMs)
        : 0,
    decodeMs: input.decodeMs,
    draftDecodeMs: input.session.draftDecodeMsTotal,
    refinementDecodeMs: input.session.refinementDecodeMsTotal,
    totalChunks: input.session.nextSequence,
    totalBatches: input.session.totalBatches,
    endpointedSegmentCount: input.session.endpointedSegmentCount,
    draftPassCount: input.session.draftPassCount,
    refinementPassCount: input.session.refinementPassCount,
    engine: input.session.engine,
  };
}

function getDraftText(session: SpeechToTextSessionRecord): string {
  return session.draftSegments.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function appendUtteranceToSessionAudio(
  session: SpeechToTextSessionRecord,
  buffers: ReadonlyArray<Buffer>,
): void {
  if (buffers.length === 0) {
    return;
  }
  if (session.sessionAudioBuffers.length > 0) {
    session.sessionAudioBuffers.push(Buffer.alloc(Math.round((16_000 * 2 * 220) / 1000)));
  }
  session.sessionAudioBuffers.push(...buffers);
  session.endpointedSegmentCount += 1;
}

function createSessionRecord(input: {
  id: string;
  selectedModelId: string;
  resources: SpeechToTextResolvedResources;
  draftResources: SpeechToTextResolvedResources | null;
}): SpeechToTextSessionRecord {
  return {
    id: input.id,
    startedAt: Date.now(),
    engine: "whisper-server",
    settings: input.resources.settings,
    selectedModelId: input.selectedModelId,
    language: input.resources.language,
    prompt: input.resources.prompt,
    primaryResources: input.resources,
    draftResources: input.draftResources,
    nextSequence: 0,
    segmentIndex: 0,
    totalAudioMs: 0,
    totalBatches: 0,
    partialText: "",
    draftSegments: [],
    isStopping: false,
    detectedSpeech: false,
    speechDurationMs: 0,
    silenceDurationMs: 0,
    utteranceBuffers: [],
    utteranceDurationMs: 0,
    sessionAudioBuffers: [],
    previewQueuedAtMs: 0,
    previewInFlight: false,
    previewPending: false,
    completionPublished: false,
    stopRequestedAtMs: null,
    lastAppendCompletedAtMs: null,
    insertedDraftText: null,
    finalTranscript: null,
    draftDecodeMsTotal: 0,
    refinementDecodeMsTotal: 0,
    draftPassCount: 0,
    refinementPassCount: 0,
    endpointedSegmentCount: 0,
    finalizeChain: Promise.resolve(),
    lastError: null,
  };
}

export const makeSpeechToText = Effect.gen(function* () {
  const { stateDir, mode, host } = yield* ServerConfig;
  const paths = resolveSpeechToTextPaths(stateDir);
  const configStore = createSpeechToTextConfigStore(paths.configPath);
  const stateChangesPubSub = yield* PubSub.unbounded<SpeechToTextState>();
  const sessionEventsPubSub = yield* PubSub.unbounded<SpeechToTextSessionEvent>();
  const downloadMutex = createAsyncMutex();
  const transcriptionMutex = createAsyncMutex();
  const sidecar = createWhisperSidecarManager();
  const runtimeTarget = resolveRuntimePlatformTarget();
  const available =
    process.env.SAMSCODE_ENABLE_REMOTE_STT === "1" ||
    process.env.SAMSCODE_ENABLE_REMOTE_STT === "true" ||
    mode === "desktop" ||
    isLoopbackHost(host);
  const sessions = new Map<string, SpeechToTextSessionRecord>();
  let started = false;
  let warmupInFlight: Promise<void> | null = null;
  let cachedConfig: SpeechToTextConfigRecord | null = null;
  let shutdownHooksInstalled = false;
  const mutableState: SpeechToTextMutableState = {
    activeDownload: null,
    errorMessage: null,
    runtimeErrorMessage: null,
  };

  const loadConfig = async (): Promise<SpeechToTextConfigRecord> => {
    if (cachedConfig) {
      return cachedConfig;
    }
    cachedConfig = await configStore.load();
    return cachedConfig;
  };

  const saveConfig = async (config: SpeechToTextConfigRecord): Promise<void> => {
    cachedConfig = config;
    await configStore.save(config);
  };

  const ensureDirectories = async (): Promise<void> => {
    await Promise.all([
      fs.mkdir(paths.rootDir, { recursive: true }),
      fs.mkdir(paths.modelsDir, { recursive: true }),
      fs.mkdir(paths.resourcesDir, { recursive: true }),
      fs.mkdir(paths.runtimeRootDir, { recursive: true }),
      fs.mkdir(paths.downloadsDir, { recursive: true }),
      fs.mkdir(paths.tmpDir, { recursive: true }),
    ]);
  };

  const loadResolvedConfig = async (): Promise<SpeechToTextConfigRecord> => {
    const config = await loadConfig();
    const installedModels = await listInstalledModels(paths.modelsDir, config.selectedModelId);
    const selectedModelId = installedModels.some((entry) => entry.id === config.selectedModelId)
      ? config.selectedModelId
      : resolvePreferredInstalledModelId({
          installedModels,
          settings: config.settings,
        });

    if (selectedModelId !== config.selectedModelId) {
      const nextConfig = { ...config, selectedModelId };
      await saveConfig(nextConfig);
      return nextConfig;
    }

    return config;
  };

  const resolveCurrentState = async (): Promise<SpeechToTextState> => {
    await ensureDirectories();
    const config = await loadResolvedConfig();
    const installedModels = await listInstalledModels(paths.modelsDir, config.selectedModelId);

    const runtimeBinaryPath = await resolveInstalledRuntimeBinaryPath(
      paths.runtimePlatformDir,
      runtimeTarget.binaryName,
    );
    const runtimeCompatible = runtimeBinaryPath
      ? await isRuntimeInstallationCompatible({
          runtimeManifestPath: paths.runtimeManifestPath,
          target: runtimeTarget,
        })
      : false;

    const runtimeStatus = !available
      ? "missing"
      : mutableState.activeDownload?.type === "runtime"
        ? "downloading"
        : mutableState.runtimeErrorMessage
          ? "error"
          : runtimeBinaryPath && runtimeCompatible
            ? "ready"
            : "missing";

    return {
      available,
      runtimeStatus,
      selectedModelId: config.selectedModelId,
      installedModels,
      catalog: [...SPEECH_TO_TEXT_MODEL_CATALOG],
      activeDownload: mutableState.activeDownload,
      settings: config.settings,
      errorMessage:
        mutableState.errorMessage ??
        (!available ? "Speech-to-text is only enabled for local Sam's Code servers." : null),
    };
  };

  const publishState = async (): Promise<SpeechToTextState> => {
    const state = await resolveCurrentState();
    await Effect.runPromise(PubSub.publish(stateChangesPubSub, state).pipe(Effect.asVoid));
    return state;
  };

  const publishSessionEvent = async (event: SpeechToTextSessionEvent): Promise<void> => {
    await Effect.runPromise(PubSub.publish(sessionEventsPubSub, event).pipe(Effect.asVoid));
  };

  const ensureRuntimeInstalledInternal = async (): Promise<string> => {
    await ensureDirectories();
    const existingBinaryPath = await resolveInstalledRuntimeBinaryPath(
      paths.runtimePlatformDir,
      runtimeTarget.binaryName,
    );
    const existingRuntimeCompatible = existingBinaryPath
      ? await isRuntimeInstallationCompatible({
          runtimeManifestPath: paths.runtimeManifestPath,
          target: runtimeTarget,
        })
      : false;
    if (existingBinaryPath && existingRuntimeCompatible) {
      mutableState.runtimeErrorMessage = null;
      return existingBinaryPath;
    }
    if (!available) {
      throw new Error("Speech-to-text is unavailable on this server.");
    }
    if (!runtimeTarget.supported) {
      throw new Error(
        `Speech-to-text runtime download is not supported on ${runtimeTarget.displayName}.`,
      );
    }

    const { asset, tagName } = await resolveRuntimeReleaseAsset();
    const archivePath = buildRuntimeArchiveTempPath(paths.downloadsDir, asset.name);
    const extractDir = `${paths.runtimePlatformDir}.tmp-${Date.now()}`;
    mutableState.errorMessage = null;
    mutableState.runtimeErrorMessage = null;
    mutableState.activeDownload = {
      type: "runtime",
      phase: "downloading-runtime",
      downloadedBytes: 0,
      totalBytes: asset.size,
      message: `Downloading whisper.cpp ${tagName}`,
    };
    await publishState();

    try {
      await downloadFileToPath({
        url: asset.browser_download_url,
        destinationPath: archivePath,
        onProgress: async (downloadedBytes, totalBytes) => {
          mutableState.activeDownload = {
            type: "runtime",
            phase: "downloading-runtime",
            downloadedBytes,
            totalBytes,
            message: `Downloading whisper.cpp ${tagName}`,
          };
          await publishState();
        },
      });
      mutableState.activeDownload = {
        type: "runtime",
        phase: "extracting-runtime",
        downloadedBytes: asset.size,
        totalBytes: asset.size,
        message: "Extracting whisper.cpp runtime",
      };
      await publishState();

      await extractRuntimeArchive({ archivePath, destinationDir: extractDir });
      const extractedBinaryPath = await resolveInstalledRuntimeBinaryPath(
        extractDir,
        runtimeTarget.binaryName,
      );
      if (!extractedBinaryPath) {
        throw new Error("Downloaded whisper.cpp runtime did not contain whisper-cli.");
      }

      await ensureRuntimeBinaryPermissions(extractedBinaryPath);
      await writeRuntimeInstallationMetadata(path.join(extractDir, "runtime-manifest.json"), {
        assetName: asset.name,
        tagName,
      });
      await fs.rm(paths.runtimePlatformDir, { recursive: true, force: true });
      await fs.rename(extractDir, paths.runtimePlatformDir);
      const installedBinaryPath = await resolveInstalledRuntimeBinaryPath(
        paths.runtimePlatformDir,
        runtimeTarget.binaryName,
      );
      if (!installedBinaryPath) {
        throw new Error("Installed whisper.cpp runtime could not be resolved.");
      }

      mutableState.activeDownload = null;
      mutableState.runtimeErrorMessage = null;
      await publishState();
      return installedBinaryPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime download failed.";
      mutableState.activeDownload = null;
      mutableState.runtimeErrorMessage = message;
      mutableState.errorMessage = message;
      await publishState();
      throw new Error(message, { cause: error });
    } finally {
      await fs.rm(archivePath, { force: true }).catch(() => undefined);
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const resolveModelResources = async (
    modelId: string,
    settings: SpeechToTextSettings,
  ): Promise<SpeechToTextResolvedResources> => {
    if (!available) {
      throw new Error("Speech-to-text is unavailable on this server.");
    }

    const modelEntry = getSpeechToTextCatalogEntry(modelId);
    if (!modelEntry) {
      throw new Error("Selected speech-to-text model is no longer supported.");
    }

    const modelPath = path.join(paths.modelsDir, modelEntry.fileName);
    if (!(await fileExists(modelPath))) {
      throw new Error("Selected speech-to-text model is not installed.");
    }

    await downloadMutex.run(() => ensureRuntimeInstalledInternal());
    const sidecarBinaryPath = await resolveInstalledRuntimeBinaryPath(
      paths.runtimePlatformDir,
      resolveWhisperSidecarBinaryName(),
    );
    if (!sidecarBinaryPath) {
      throw new Error("Installed whisper.cpp runtime does not include whisper-server.");
    }
    const language = getLanguageForModel(settings, modelId);
    const prompt = getPromptForSettings(settings);
    const vadModelPath = shouldUseSidecarVad(settings)
      ? await downloadMutex.run(() => ensureVadModelInstalled({ paths }))
      : undefined;

    return {
      sidecarBinaryPath,
      modelId: modelEntry.id,
      modelName: modelEntry.name,
      modelPath,
      settings,
      language,
      prompt,
      threads: getDefaultDecodeThreads(),
      vadModelPath,
    };
  };

  const resolveSelectedModelResources = async (): Promise<SpeechToTextResolvedResources> => {
    const config = await loadResolvedConfig();
    if (!config.selectedModelId) {
      throw new Error("Install and select a speech-to-text model first.");
    }
    return resolveModelResources(config.selectedModelId, config.settings);
  };

  const resolveDraftResources = async (
    selectedResources: SpeechToTextResolvedResources,
  ): Promise<SpeechToTextResolvedResources | null> => {
    if (selectedResources.language !== "en") {
      return null;
    }
    if (selectedResources.modelId === "ggml-base.en.bin") {
      return selectedResources;
    }

    const draftEntry = getSpeechToTextCatalogEntry("ggml-base.en.bin");
    if (!draftEntry) {
      return null;
    }
    if (!(await fileExists(path.join(paths.modelsDir, draftEntry.fileName)))) {
      return null;
    }

    return resolveModelResources("ggml-base.en.bin", {
      ...selectedResources.settings,
      qualityProfile: "fast",
      useVad: false,
    });
  };

  const queueWarmup = async (): Promise<void> => {
    if (warmupInFlight) {
      return warmupInFlight;
    }

    warmupInFlight = (async () => {
      try {
        const resources = await resolveSelectedModelResources();
        const draftResources = await resolveDraftResources(resources);
        if (!resources.settings.warmupEnabled) {
          return;
        }

        await sidecar.ensureStarted({
          binaryPath: resources.sidecarBinaryPath,
          modelPath: resources.modelPath,
          threads: resources.threads,
          useVad: shouldUseSidecarVad(resources.settings),
          vadModelPath: resources.vadModelPath,
          tmpDir: paths.tmpDir,
        });
        await sidecar.warm({
          config: {
            binaryPath: resources.sidecarBinaryPath,
            modelPath: resources.modelPath,
            threads: resources.threads,
            useVad: shouldUseSidecarVad(resources.settings),
            vadModelPath: resources.vadModelPath,
            tmpDir: paths.tmpDir,
          },
          language: resources.language,
          prompt: resources.prompt,
          qualityProfile: resources.settings.qualityProfile,
        });
        if (draftResources) {
          await sidecar.warm({
            config: {
              binaryPath: draftResources.sidecarBinaryPath,
              modelPath: draftResources.modelPath,
              threads: draftResources.threads,
              useVad: shouldUseSidecarVad(draftResources.settings),
              vadModelPath: draftResources.vadModelPath,
              tmpDir: paths.tmpDir,
            },
            language: draftResources.language,
            prompt: draftResources.prompt,
            qualityProfile: "fast",
          });
        }
      } catch {
        // Best effort only.
      } finally {
        warmupInFlight = null;
      }
    })();

    return warmupInFlight;
  };

  const transcribeWithResources = async (input: {
    readonly resources: SpeechToTextResolvedResources;
    readonly buffers: ReadonlyArray<Buffer>;
    readonly qualityProfile: SpeechToTextSettings["qualityProfile"];
  }): Promise<{ text: string; decodeMs: number }> => {
    try {
      return await sidecar.transcribe({
        config: {
          binaryPath: input.resources.sidecarBinaryPath,
          modelPath: input.resources.modelPath,
          threads: input.resources.threads,
          useVad: shouldUseSidecarVad(input.resources.settings),
          vadModelPath: input.resources.vadModelPath,
          tmpDir: paths.tmpDir,
        },
        inference: {
          wavBuffer: createWavBufferFromPcmChunks(input.buffers),
          language: input.resources.language,
          prompt: input.resources.prompt,
          qualityProfile: input.qualityProfile,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Speech transcription failed while decoding audio.";
      throw new Error(normalizeWhisperCliErrorMessage(message, input.resources.modelName), {
        cause: error,
      });
    }
  };

  const takeUtterance = (session: SpeechToTextSessionRecord) => {
    if (session.utteranceBuffers.length === 0 || session.speechDurationMs < MIN_SPEECH_MS) {
      session.detectedSpeech = false;
      session.speechDurationMs = 0;
      session.silenceDurationMs = 0;
      session.utteranceBuffers = [];
      session.utteranceDurationMs = 0;
      session.partialText = "";
      session.previewPending = false;
      return null;
    }

    const utterance = {
      segmentIndex: session.segmentIndex,
      buffers: session.utteranceBuffers,
    };
    session.segmentIndex += 1;
    session.detectedSpeech = false;
    session.speechDurationMs = 0;
    session.silenceDurationMs = 0;
    session.utteranceBuffers = [];
    session.utteranceDurationMs = 0;
    session.partialText = "";
    session.previewPending = false;
    return utterance;
  };

  const resolvePreviewResources = (
    session: SpeechToTextSessionRecord,
  ): SpeechToTextResolvedResources | null => {
    if (session.draftResources) {
      return session.draftResources;
    }
    return supportsLivePartialPreview(session.selectedModelId) ? session.primaryResources : null;
  };

  const queueDraftUtterance = (
    session: SpeechToTextSessionRecord,
    buffers: ReadonlyArray<Buffer>,
    segmentIndex: number,
  ): void => {
    session.finalizeChain = session.finalizeChain.then(async () => {
      try {
        const draftResources =
          session.draftResources ??
          (session.settings.refinementMode === "draft-only" ? session.primaryResources : null);
        if (!draftResources) {
          return;
        }

        const draftResult = await transcriptionMutex.run(() =>
          transcribeWithResources({
            resources: draftResources,
            buffers,
            qualityProfile: "fast",
          }),
        );
        const text = draftResult.text.trim();
        if (text.length === 0) {
          return;
        }

        const latest = sessions.get(session.id);
        if (!latest) {
          return;
        }
        latest.draftPassCount += 1;
        latest.draftDecodeMsTotal += draftResult.decodeMs;
        latest.draftSegments[segmentIndex] = text;
        const event: SpeechToTextSessionSegmentCommittedEvent = {
          type: "segmentCommitted",
          sessionId: latest.id,
          segmentIndex,
          text,
        };
        await publishSessionEvent(event);

        const draftText = getDraftText(latest);
        if (draftText.length > 0 && draftText !== latest.insertedDraftText) {
          latest.insertedDraftText = draftText;
          const draftMetrics = createFinalMetrics({
            session: latest,
            decodeMs: draftResult.decodeMs,
          });
          console.info("[speech-to-text] draft metrics", {
            sessionId: latest.id,
            stage: "draft",
            ...draftMetrics,
          });
          await publishSessionEvent({
            type: "final",
            stage: "draft",
            sessionId: latest.id,
            text: draftText,
            elapsedMs: Date.now() - latest.startedAt,
            metrics: draftMetrics,
          });
        }
      } catch (error) {
        const latest = sessions.get(session.id);
        if (latest) {
          latest.lastError =
            error instanceof Error ? error.message : "Speech transcription failed.";
          await publishSessionEvent({
            type: "error",
            sessionId: session.id,
            message: latest.lastError,
          });
        }
      }
    });
  };

  const queueSessionCompletion = (session: SpeechToTextSessionRecord): void => {
    session.finalizeChain = session.finalizeChain.then(async () => {
      const latest = sessions.get(session.id);
      if (!latest || latest.completionPublished) {
        return;
      }

      let finalText = getDraftText(latest);
      let finalStage: SpeechToTextSessionFinalEvent["stage"] = "single";

      if (
        latest.settings.refinementMode === "refine-on-stop" &&
        latest.sessionAudioBuffers.length > 0
      ) {
        try {
          const refinementResult = await transcriptionMutex.run(() =>
            transcribeWithResources({
              resources: latest.primaryResources,
              buffers: latest.sessionAudioBuffers,
              qualityProfile: latest.primaryResources.settings.qualityProfile,
            }),
          );
          const refinedText = refinementResult.text.trim();
          latest.refinementPassCount += 1;
          latest.refinementDecodeMsTotal += refinementResult.decodeMs;
          if (refinedText.length > 0) {
            finalText = refinedText;
            finalStage = latest.insertedDraftText ? "refined" : "single";
          }
        } catch (error) {
          latest.lastError =
            error instanceof Error ? error.message : "Speech transcription failed.";
        }
      }

      latest.finalTranscript = finalText.length > 0 ? finalText : null;
      latest.completionPublished = true;

      if (latest.finalTranscript) {
        const metrics = createFinalMetrics({
          session: latest,
          decodeMs: latest.refinementDecodeMsTotal || latest.draftDecodeMsTotal,
        });
        const finalEvent: SpeechToTextSessionFinalEvent = {
          type: "final",
          stage: finalStage,
          sessionId: latest.id,
          text: latest.finalTranscript,
          elapsedMs: Date.now() - latest.startedAt,
          metrics,
        };
        console.info("[speech-to-text] final metrics", {
          sessionId: latest.id,
          stage: finalStage,
          ...metrics,
        });
        await publishSessionEvent(finalEvent);
        await publishSessionEvent({
          type: "ended",
          sessionId: latest.id,
          reason: "completed",
        });
      } else {
        await publishSessionEvent({
          type: "error",
          sessionId: latest.id,
          message: latest.lastError ?? "No speech was detected in the recording.",
        });
        await publishSessionEvent({
          type: "ended",
          sessionId: latest.id,
          reason: latest.lastError ? "error" : "cancelled",
        });
      }

      sessions.delete(latest.id);
    });
  };

  const queuePartialPreview = (session: SpeechToTextSessionRecord): void => {
    if (session.isStopping) {
      return;
    }
    const now = Date.now();
    if (now - session.previewQueuedAtMs < PREVIEW_INTERVAL_MS) {
      return;
    }
    if (session.utteranceDurationMs < PREVIEW_MIN_AUDIO_MS) {
      return;
    }
    const previewResources = resolvePreviewResources(session);
    if (!previewResources) {
      return;
    }
    session.previewQueuedAtMs = now;
    if (session.previewInFlight) {
      session.previewPending = true;
      return;
    }
    session.previewInFlight = true;
    const snapshotBuffers = [...session.utteranceBuffers];
    const snapshotSegmentIndex = session.segmentIndex;

    void transcriptionMutex
      .run(() =>
        transcribeWithResources({
          resources: previewResources,
          buffers: snapshotBuffers,
          qualityProfile: "fast",
        }),
      )
      .then(async (result) => {
        const latest = sessions.get(session.id);
        if (!latest || latest.segmentIndex !== snapshotSegmentIndex) {
          return;
        }
        const normalized = result.text.trim();
        if (latest.partialText === normalized) {
          return;
        }
        latest.partialText = normalized;
        const event: SpeechToTextSessionPartialEvent = {
          type: "partial",
          sessionId: latest.id,
          segmentIndex: snapshotSegmentIndex,
          text: normalized,
        };
        await publishSessionEvent(event);
      })
      .catch(() => undefined)
      .finally(() => {
        const latest = sessions.get(session.id);
        if (!latest) {
          return;
        }
        latest.previewInFlight = false;
        if (!latest.previewPending || latest.isStopping) {
          latest.previewPending = false;
          return;
        }
        latest.previewPending = false;
        queuePartialPreview(latest);
      });
  };

  const appendAudioChunkToSession = async (
    session: SpeechToTextSessionRecord,
    chunkInput: SpeechToTextAudioChunk,
  ): Promise<void> => {
    if (session.isStopping) {
      return;
    }
    if (chunkInput.sequence !== session.nextSequence) {
      throw new Error(
        `Speech-to-text audio chunk was out of sequence (expected ${session.nextSequence}, got ${chunkInput.sequence}).`,
      );
    }

    session.nextSequence += 1;
    session.totalAudioMs += chunkInput.durationMs;

    const chunk = decodePcmBase64(chunkInput.pcmBase64);
    const rms = calculateChunkRms(chunk);
    const hasSpeech = isSpeechChunk({
      rms,
      alreadyDetectedSpeech: session.detectedSpeech,
    });

    if (hasSpeech) {
      session.detectedSpeech = true;
      session.speechDurationMs += chunkInput.durationMs;
      session.silenceDurationMs = 0;
      session.utteranceBuffers.push(chunk);
      session.utteranceDurationMs += chunkInput.durationMs;
      if (session.settings.partialTranscriptsEnabled && resolvePreviewResources(session) !== null) {
        queuePartialPreview(session);
      }
      return;
    }

    if (!session.detectedSpeech) {
      return;
    }

    session.silenceDurationMs += chunkInput.durationMs;
    session.utteranceBuffers.push(chunk);
    session.utteranceDurationMs += chunkInput.durationMs;
    if (session.settings.partialTranscriptsEnabled && resolvePreviewResources(session) !== null) {
      queuePartialPreview(session);
    }

    if (
      session.settings.endpointingEnabled &&
      session.silenceDurationMs >= session.settings.endpointSilenceMs
    ) {
      const utterance = takeUtterance(session);
      if (!utterance) {
        return;
      }
      appendUtteranceToSessionAudio(session, utterance.buffers);
      queueDraftUtterance(session, utterance.buffers, utterance.segmentIndex);
    }
  };

  return {
    start: Effect.tryPromise(async () => {
      if (started) {
        return;
      }
      started = true;
      if (!shutdownHooksInstalled) {
        shutdownHooksInstalled = true;
        const stopSidecar = () => {
          void sidecar.stop();
        };
        process.once("exit", stopSidecar);
        process.once("SIGINT", stopSidecar);
        process.once("SIGTERM", stopSidecar);
      }
      await ensureDirectories();
      await Promise.all([
        removeMatchingTemporaryEntries(paths.downloadsDir),
        removeMatchingTemporaryEntries(paths.tmpDir),
        removeMatchingTemporaryEntries(paths.runtimeRootDir),
      ]);
      await publishState();
      void queueWarmup();
    }),
    getState: Effect.tryPromise(() => resolveCurrentState()),
    downloadModel: (input) =>
      Effect.tryPromise(() =>
        downloadMutex.run(async () => {
          if (!available) {
            throw new Error("Speech-to-text is unavailable on this server.");
          }

          const entry = getSpeechToTextCatalogEntry(input.modelId);
          if (!entry) {
            throw new Error(`Unknown speech-to-text model: ${input.modelId}`);
          }

          await ensureDirectories();
          await ensureRuntimeInstalledInternal();

          const installedPath = path.join(paths.modelsDir, entry.fileName);
          if (await fileExists(installedPath)) {
            mutableState.errorMessage = null;
            return publishState();
          }

          const downloadPath = path.join(
            paths.downloadsDir,
            `${entry.fileName}.${Date.now()}.download`,
          );
          const modelUrl = resolveSpeechToTextModelDownloadUrl(entry.fileName);
          mutableState.errorMessage = null;
          mutableState.activeDownload = {
            type: "model",
            phase: "downloading-model",
            modelId: entry.id,
            downloadedBytes: 0,
            totalBytes: entry.sizeBytes,
            message: `Downloading ${entry.name}`,
          };
          await publishState();

          try {
            await downloadFileToPath({
              url: modelUrl,
              destinationPath: downloadPath,
              onProgress: async (downloadedBytes, totalBytes) => {
                mutableState.activeDownload = {
                  type: "model",
                  phase: "downloading-model",
                  modelId: entry.id,
                  downloadedBytes,
                  totalBytes,
                  message: `Downloading ${entry.name}`,
                };
                await publishState();
              },
            });
            await fs.rename(downloadPath, installedPath);
            const config = await loadResolvedConfig();
            if (!config.selectedModelId) {
              await saveConfig({
                ...config,
                selectedModelId: entry.id,
              });
            }
            mutableState.activeDownload = null;
            mutableState.errorMessage = null;
            const state = await publishState();
            void queueWarmup();
            return state;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Model download failed.";
            mutableState.activeDownload = null;
            mutableState.errorMessage = message;
            await publishState();
            throw new Error(message, { cause: error });
          } finally {
            await fs.rm(downloadPath, { force: true }).catch(() => undefined);
          }
        }),
      ),
    deleteModel: (input) =>
      Effect.tryPromise(async () => {
        const entry = getSpeechToTextCatalogEntry(input.modelId);
        if (!entry) {
          throw new Error(`Unknown speech-to-text model: ${input.modelId}`);
        }

        await fs
          .rm(path.join(paths.modelsDir, entry.fileName), { force: true })
          .catch(() => undefined);
        const config = await loadConfig();
        if (config.selectedModelId === entry.id) {
          await saveConfig({ ...config, selectedModelId: null });
        }
        mutableState.errorMessage = null;
        return publishState();
      }),
    selectModel: (input) =>
      Effect.tryPromise(async () => {
        const entry = getSpeechToTextCatalogEntry(input.modelId);
        if (!entry) {
          throw new Error(`Unknown speech-to-text model: ${input.modelId}`);
        }

        const modelPath = path.join(paths.modelsDir, entry.fileName);
        if (!(await fileExists(modelPath))) {
          throw new Error("Install this speech-to-text model before selecting it.");
        }

        const config = await loadConfig();
        await saveConfig({ ...config, selectedModelId: entry.id });
        mutableState.errorMessage = null;
        const state = await publishState();
        void queueWarmup();
        return state;
      }),
    updatePreferences: (input) =>
      Effect.tryPromise(async () => {
        const config = await loadConfig();
        await saveConfig({
          ...config,
          settings: input,
        });
        mutableState.errorMessage = null;
        const state = await publishState();
        void queueWarmup();
        return state;
      }),
    startSession: Effect.tryPromise(async () => {
      const resources = await resolveSelectedModelResources();
      const draftResources = await resolveDraftResources(resources);
      await sidecar.ensureStarted({
        binaryPath: resources.sidecarBinaryPath,
        modelPath: resources.modelPath,
        threads: resources.threads,
        useVad: shouldUseSidecarVad(resources.settings),
        vadModelPath: resources.vadModelPath,
        tmpDir: paths.tmpDir,
      });
      void sidecar.warm({
        config: {
          binaryPath: resources.sidecarBinaryPath,
          modelPath: resources.modelPath,
          threads: resources.threads,
          useVad: shouldUseSidecarVad(resources.settings),
          vadModelPath: resources.vadModelPath,
          tmpDir: paths.tmpDir,
        },
        language: resources.language,
        prompt: resources.prompt,
        qualityProfile: resources.settings.qualityProfile,
      });
      if (draftResources) {
        void sidecar.ensureStarted({
          binaryPath: draftResources.sidecarBinaryPath,
          modelPath: draftResources.modelPath,
          threads: draftResources.threads,
          useVad: shouldUseSidecarVad(draftResources.settings),
          vadModelPath: draftResources.vadModelPath,
          tmpDir: paths.tmpDir,
        });
        void sidecar.warm({
          config: {
            binaryPath: draftResources.sidecarBinaryPath,
            modelPath: draftResources.modelPath,
            threads: draftResources.threads,
            useVad: shouldUseSidecarVad(draftResources.settings),
            vadModelPath: draftResources.vadModelPath,
            tmpDir: paths.tmpDir,
          },
          language: draftResources.language,
          prompt: draftResources.prompt,
          qualityProfile: "fast",
        });
      }
      const sessionId = randomUUID();
      const session = createSessionRecord({
        id: sessionId,
        selectedModelId: resources.modelId,
        resources,
        draftResources,
      });
      sessions.set(sessionId, session);
      mutableState.errorMessage = null;
      await publishState();
      const event: SpeechToTextSessionStartedEvent = {
        type: "started",
        sessionId,
      };
      await publishSessionEvent(event);
      return { sessionId };
    }),
    appendAudioBatch: (input) =>
      Effect.tryPromise(async () => {
        const session = sessions.get(input.sessionId);
        if (!session) {
          throw new Error("Speech-to-text session not found.");
        }
        session.totalBatches += 1;
        for (const chunk of input.chunks) {
          await appendAudioChunkToSession(session, chunk);
        }
        session.lastAppendCompletedAtMs = Date.now();
      }),
    stopSession: (input) =>
      Effect.tryPromise(async () => {
        const session = sessions.get(input.sessionId);
        if (!session) {
          return;
        }
        if (session.isStopping) {
          return;
        }

        session.isStopping = true;
        session.stopRequestedAtMs = Date.now();
        session.previewPending = false;
        const utterance = takeUtterance(session);
        if (utterance) {
          appendUtteranceToSessionAudio(session, utterance.buffers);
          queueDraftUtterance(session, utterance.buffers, utterance.segmentIndex);
        }
        queueSessionCompletion(session);
      }),
    cancelSession: (input) =>
      Effect.tryPromise(async () => {
        const session = sessions.get(input.sessionId);
        if (!session) {
          return;
        }
        sessions.delete(input.sessionId);
        await publishSessionEvent({
          type: "ended",
          sessionId: input.sessionId,
          reason: "cancelled",
        });
      }),
    get streamChanges() {
      return Stream.fromPubSub(stateChangesPubSub);
    },
    get streamSessionEvents() {
      return Stream.fromPubSub(sessionEventsPubSub);
    },
  } satisfies SpeechToTextShape;
});
