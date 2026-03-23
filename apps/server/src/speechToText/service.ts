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
  SpeechToTextSettings,
  SpeechToTextState,
} from "@samscode/contracts";
import { Effect, PubSub, ServiceMap, Stream } from "effect";

import { ServerConfig } from "../config";
import {
  DEFAULT_ENGLISH_SPEECH_TO_TEXT_MODEL_ID,
  DEFAULT_MULTILINGUAL_SPEECH_TO_TEXT_MODEL_ID,
  getSpeechToTextCatalogEntry,
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
import { calculateChunkRms, decodePcmBase64, writePcmChunksToWavFile } from "./pcmWav";
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
  SpeechToTextSessionRecord,
  SpeechToTextShape,
} from "./types";
import { runSpeechToTextWarmup } from "./warmup";
import { transcribeWithWhisperCli } from "./whisperCli";

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

async function removeWhisperOutputFiles(outputBasePath: string): Promise<void> {
  await Promise.all([
    fs.rm(`${outputBasePath}.json`, { force: true }).catch(() => undefined),
    fs.rm(`${outputBasePath}.txt`, { force: true }).catch(() => undefined),
    fs.rm(`${outputBasePath}.srt`, { force: true }).catch(() => undefined),
    fs.rm(`${outputBasePath}.vtt`, { force: true }).catch(() => undefined),
  ]);
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

function createEmptySessionRecord(id: string): SpeechToTextSessionRecord {
  return {
    id,
    startedAt: Date.now(),
    nextSequence: 0,
    segmentIndex: 0,
    totalAudioMs: 0,
    partialText: "",
    committedSegments: [],
    isStopping: false,
    detectedSpeech: false,
    speechDurationMs: 0,
    silenceDurationMs: 0,
    utteranceBuffers: [],
    utteranceDurationMs: 0,
    previewQueuedAtMs: 0,
    previewInFlight: false,
    previewPending: false,
    completionPublished: false,
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

  const resolveSelectedModelResources = async (): Promise<{
    binaryPath: string;
    modelId: string;
    modelName: string;
    modelPath: string;
    settings: SpeechToTextSettings;
    language: string;
    prompt: string;
    vadModelPath: string | undefined;
  }> => {
    if (!available) {
      throw new Error("Speech-to-text is unavailable on this server.");
    }

    const config = await loadResolvedConfig();
    const selectedModelId = config.selectedModelId;
    if (!selectedModelId) {
      throw new Error("Install and select a speech-to-text model first.");
    }

    const modelEntry = getSpeechToTextCatalogEntry(selectedModelId);
    if (!modelEntry) {
      throw new Error("Selected speech-to-text model is no longer supported.");
    }

    const modelPath = path.join(paths.modelsDir, modelEntry.fileName);
    if (!(await fileExists(modelPath))) {
      throw new Error("Selected speech-to-text model is not installed.");
    }

    const binaryPath = await downloadMutex.run(() => ensureRuntimeInstalledInternal());
    const language = getLanguageForModel(config.settings, selectedModelId);
    const prompt = getPromptForSettings(config.settings);
    const vadModelPath = config.settings.useVad
      ? await downloadMutex.run(() => ensureVadModelInstalled({ paths }))
      : undefined;

    return {
      binaryPath,
      modelId: modelEntry.id,
      modelName: modelEntry.name,
      modelPath,
      settings: config.settings,
      language,
      prompt,
      vadModelPath,
    };
  };

  const queueWarmup = async (): Promise<void> => {
    if (warmupInFlight) {
      return warmupInFlight;
    }

    warmupInFlight = (async () => {
      try {
        const resources = await resolveSelectedModelResources();
        if (!resources.settings.warmupEnabled) {
          return;
        }

        await runSpeechToTextWarmup({
          binaryPath: resources.binaryPath,
          modelPath: resources.modelPath,
          tmpDir: paths.tmpDir,
          language: resources.language,
          prompt: resources.prompt,
          useVad: resources.settings.useVad,
          vadModelPath: resources.vadModelPath,
        });
      } catch {
        // Best effort only.
      } finally {
        warmupInFlight = null;
      }
    })();

    return warmupInFlight;
  };

  const transcribeBuffers = async (buffers: ReadonlyArray<Buffer>): Promise<string> => {
    const resources = await resolveSelectedModelResources();
    const outputBasePath = path.join(paths.tmpDir, `${Date.now()}-${randomUUID()}-whisper-output`);
    const wavPath = path.join(paths.tmpDir, `${Date.now()}-${randomUUID()}.wav`);

    try {
      await writePcmChunksToWavFile(wavPath, buffers);
      const transcription = await transcribeWithWhisperCli({
        binaryPath: resources.binaryPath,
        modelPath: resources.modelPath,
        audioPath: wavPath,
        outputBasePath,
        language: resources.language,
        prompt: resources.prompt,
        useVad: resources.settings.useVad,
        vadModelPath: resources.vadModelPath,
      });
      return transcription.text;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Speech transcription failed while decoding audio.";
      throw new Error(normalizeWhisperCliErrorMessage(message, resources.modelName), {
        cause: error,
      });
    } finally {
      await fs.rm(wavPath, { force: true }).catch(() => undefined);
      await removeWhisperOutputFiles(outputBasePath);
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

  const maybeCompleteStoppingSession = (sessionId: string): void => {
    void (async () => {
      const session = sessions.get(sessionId);
      if (!session || !session.isStopping || session.completionPublished) {
        return;
      }

      const finalizeChain = session.finalizeChain;
      await finalizeChain.catch(() => undefined);
      const latest = sessions.get(sessionId);
      if (
        !latest ||
        !latest.isStopping ||
        latest.finalizeChain !== finalizeChain ||
        latest.completionPublished
      ) {
        return;
      }

      if (latest.utteranceBuffers.length > 0) {
        return;
      }

      const finalText = latest.committedSegments.join(" ").replace(/\s+/g, " ").trim();
      latest.completionPublished = true;

      if (finalText.length > 0) {
        const finalEvent: SpeechToTextSessionFinalEvent = {
          type: "final",
          sessionId,
          text: finalText,
          elapsedMs: Date.now() - latest.startedAt,
        };
        await publishSessionEvent(finalEvent);
        await publishSessionEvent({
          type: "ended",
          sessionId,
          reason: "completed",
        });
      } else {
        await publishSessionEvent({
          type: "error",
          sessionId,
          message: latest.lastError ?? "No speech was detected in the recording.",
        });
        await publishSessionEvent({
          type: "ended",
          sessionId,
          reason: latest.lastError ? "error" : "cancelled",
        });
      }

      sessions.delete(sessionId);
    })();
  };

  const queueFinalizeUtterance = (
    session: SpeechToTextSessionRecord,
    buffers: ReadonlyArray<Buffer>,
    segmentIndex: number,
  ): void => {
    session.finalizeChain = session.finalizeChain.then(async () => {
      try {
        const text = await transcriptionMutex.run(() => transcribeBuffers(buffers));
        if (text.trim().length === 0) {
          return;
        }

        const latest = sessions.get(session.id);
        if (!latest) {
          return;
        }
        latest.committedSegments.push(text.trim());
        const event: SpeechToTextSessionSegmentCommittedEvent = {
          type: "segmentCommitted",
          sessionId: session.id,
          segmentIndex,
          text: text.trim(),
        };
        await publishSessionEvent(event);
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

    if (session.isStopping) {
      maybeCompleteStoppingSession(session.id);
    }
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
    session.previewQueuedAtMs = now;
    if (session.previewInFlight) {
      session.previewPending = true;
      return;
    }
    session.previewInFlight = true;
    const snapshotBuffers = [...session.utteranceBuffers];
    const snapshotSegmentIndex = session.segmentIndex;

    void transcriptionMutex
      .run(() => transcribeBuffers(snapshotBuffers))
      .then(async (text) => {
        const latest = sessions.get(session.id);
        if (!latest || latest.segmentIndex !== snapshotSegmentIndex) {
          return;
        }
        const normalized = text.trim();
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

  return {
    start: Effect.tryPromise(async () => {
      if (started) {
        return;
      }
      started = true;
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
          const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${encodeURIComponent(entry.fileName)}?download=true`;
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
      const sessionId = randomUUID();
      const session = createEmptySessionRecord(sessionId);
      sessions.set(sessionId, session);
      mutableState.errorMessage = null;
      await publishState();
      const event: SpeechToTextSessionStartedEvent = {
        type: "started",
        sessionId,
      };
      await publishSessionEvent(event);
      void resources;
      return { sessionId };
    }),
    appendAudio: (input) =>
      Effect.tryPromise(async () => {
        const session = sessions.get(input.sessionId);
        if (!session) {
          throw new Error("Speech-to-text session not found.");
        }
        if (session.isStopping) {
          return;
        }
        if (input.sequence !== session.nextSequence) {
          throw new Error(
            `Speech-to-text audio chunk was out of sequence (expected ${session.nextSequence}, got ${input.sequence}).`,
          );
        }
        session.nextSequence += 1;
        session.totalAudioMs += input.durationMs;

        const chunk = decodePcmBase64(input.pcmBase64);
        const rms = calculateChunkRms(chunk);
        const config = await loadResolvedConfig();
        const settings = config.settings;
        const hasSpeech = isSpeechChunk({
          rms,
          alreadyDetectedSpeech: session.detectedSpeech,
        });

        if (hasSpeech) {
          session.detectedSpeech = true;
          session.speechDurationMs += input.durationMs;
          session.silenceDurationMs = 0;
          session.utteranceBuffers.push(chunk);
          session.utteranceDurationMs += input.durationMs;
          if (
            settings.partialTranscriptsEnabled &&
            supportsLivePartialPreview(config.selectedModelId)
          ) {
            queuePartialPreview(session);
          }
          return;
        }

        if (!session.detectedSpeech) {
          return;
        }

        session.silenceDurationMs += input.durationMs;
        session.utteranceBuffers.push(chunk);
        session.utteranceDurationMs += input.durationMs;
        if (
          settings.partialTranscriptsEnabled &&
          supportsLivePartialPreview(config.selectedModelId)
        ) {
          queuePartialPreview(session);
        }

        if (
          settings.endpointingEnabled &&
          session.silenceDurationMs >= settings.endpointSilenceMs
        ) {
          const utterance = takeUtterance(session);
          if (!utterance) {
            return;
          }
          queueFinalizeUtterance(session, utterance.buffers, utterance.segmentIndex);
        }
      }),
    stopSession: (input) =>
      Effect.tryPromise(async () => {
        const session = sessions.get(input.sessionId);
        if (!session) {
          return;
        }
        if (session.isStopping) {
          maybeCompleteStoppingSession(session.id);
          return;
        }

        session.isStopping = true;
        session.previewPending = false;
        const utterance = takeUtterance(session);
        if (utterance) {
          queueFinalizeUtterance(session, utterance.buffers, utterance.segmentIndex);
        }
        maybeCompleteStoppingSession(session.id);
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
