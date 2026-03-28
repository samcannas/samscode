import os from "node:os";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  SpeechToTextInstalledModel,
  SpeechToTextSessionEvent,
  SpeechToTextSessionFinalEvent,
  SpeechToTextSessionStartedEvent,
  SpeechToTextAudioChunk,
  SpeechToTextSettings,
  SpeechToTextState,
} from "@samscode/contracts";
import { Effect, PubSub, ServiceMap, Stream } from "effect";

import { ServerConfig } from "../config";
import { TextGeneration } from "../git/Services/TextGeneration";
import {
  DEFAULT_ENGLISH_SPEECH_TO_TEXT_MODEL_ID,
  DEFAULT_MULTILINGUAL_SPEECH_TO_TEXT_MODEL_ID,
  getSpeechToTextCatalogEntry,
  getSpeechToTextModelDescriptor,
  resolveSpeechToTextModelDownload,
  SPEECH_TO_TEXT_MODEL_CATALOG,
} from "./catalog";
import { createSpeechToTextConfigStore } from "./configStore";
import { downloadFileToPath } from "./downloadManager";
import { createWavBufferFromPcmChunks, decodePcmBase64 } from "./pcmWav";
import { ensureVadModelInstalled, resolveBundledPythonSidecarScript } from "./resources";
import {
  buildRuntimeArchiveTempPath,
  buildMetalRuntimeFromSource,
  detectSpeechToTextCudaAvailability,
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
  SpeechToTextPaths,
  SpeechToTextResolvedResources,
  SpeechToTextSessionRecord,
  SpeechToTextShape,
} from "./types";
import {
  downloadPythonFamilyModel,
  ensurePythonBackendReady,
  isPythonBackendReady,
  type PythonBackendKind,
} from "./pythonRuntime";
import { createPythonSidecarManager } from "./pythonSidecar";
import { cleanupTranscriptWithLlm } from "./transcriptCleanup";
import { createWhisperSidecarManager, resolveWhisperSidecarBinaryName } from "./whisperSidecar";

export class SpeechToText extends ServiceMap.Service<SpeechToText, SpeechToTextShape>()(
  "@samscode/server/speechToText/service/SpeechToText",
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

async function artifactExists(candidatePath: string): Promise<boolean> {
  const stat = await fs.stat(candidatePath).catch(() => null);
  return stat?.isFile() === true || stat?.isDirectory() === true;
}

async function getArtifactSizeBytes(candidatePath: string): Promise<number> {
  const stat = await fs.stat(candidatePath).catch(() => null);
  if (!stat) {
    return 0;
  }
  if (stat.isFile()) {
    return stat.size;
  }
  if (!stat.isDirectory()) {
    return 0;
  }

  const entries = await fs.readdir(candidatePath, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(
    entries.map((entry) => getArtifactSizeBytes(path.join(candidatePath, entry.name))),
  );
  return sizes.reduce((sum, value) => sum + value, 0);
}

async function listInstalledModels(
  modelsDir: string,
  selectedModelId: string | null,
): Promise<SpeechToTextInstalledModel[]> {
  const installedModels = await Promise.all(
    SPEECH_TO_TEXT_MODEL_CATALOG.map(async (entry) => {
      const descriptor = getSpeechToTextModelDescriptor(entry.id);
      if (!descriptor) {
        return null;
      }
      const installedPath = path.join(modelsDir, descriptor.fileName);
      const stat = await fs.stat(installedPath).catch(() => null);
      if (!stat?.isFile() && !stat?.isDirectory()) {
        return null;
      }
      return {
        id: entry.id,
        fileName: entry.fileName,
        name: entry.name,
        family: entry.family,
        sizeBytes: await getArtifactSizeBytes(installedPath),
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

function shouldUseSidecarVad(settings: SpeechToTextSettings): boolean {
  return settings.useVad;
}

function resolvePythonBackendKind(
  engineKind: SpeechToTextResolvedResources["engineKind"],
): PythonBackendKind {
  return engineKind === "parakeet-nemo" ? "parakeet-nemo" : "faster-whisper";
}

function resolvePythonSidecarScriptPath(paths: SpeechToTextPaths): string {
  return path.join(paths.resourcesDir, "stt", "python_stt_server.py");
}

async function ensurePythonSidecarScriptInstalled(paths: SpeechToTextPaths): Promise<string> {
  const installedPath = resolvePythonSidecarScriptPath(paths);
  if (await artifactExists(installedPath)) {
    return installedPath;
  }

  const bundledPath = await resolveBundledPythonSidecarScript();
  await fs.mkdir(path.dirname(installedPath), { recursive: true });
  await fs.copyFile(bundledPath, installedPath);
  return installedPath;
}

function resolvePythonDevice(acceleration: string | null): "cpu" | "cuda" {
  return acceleration === "cuda" ? "cuda" : "cpu";
}

function resolveRuntimeAccelerationForDescriptor(input: {
  descriptor: NonNullable<ReturnType<typeof getSpeechToTextModelDescriptor>>;
  runtimeTarget: Awaited<ReturnType<typeof resolveRuntimePlatformTarget>>;
  cudaAvailable: boolean;
}): "cpu" | "cuda" | "metal" {
  if (input.descriptor.engineKind === "whisper.cpp") {
    return input.runtimeTarget.acceleration;
  }
  return input.cudaAvailable ? "cuda" : "cpu";
}

function resolvePythonComputeType(input: {
  engineKind: SpeechToTextResolvedResources["engineKind"];
  acceleration: string | null;
  qualityProfile: SpeechToTextSettings["qualityProfile"];
}): string | undefined {
  if (input.engineKind !== "faster-whisper") {
    return undefined;
  }
  if (input.acceleration === "cuda") {
    return input.qualityProfile === "quality" ? "float16" : "int8_float16";
  }
  return input.qualityProfile === "quality" ? "float32" : "int8";
}

function isDescriptorSupportedOnRuntime(input: {
  descriptor: NonNullable<ReturnType<typeof getSpeechToTextModelDescriptor>>;
  runtimeTarget: Awaited<ReturnType<typeof resolveRuntimePlatformTarget>>;
  cudaAvailable: boolean;
}): boolean {
  if (input.descriptor.engineKind === "whisper.cpp") {
    return input.runtimeTarget.supported;
  }
  if (input.descriptor.engineKind === "faster-whisper") {
    return input.cudaAvailable;
  }
  if (input.descriptor.engineKind === "parakeet-nemo") {
    return (process.platform === "linux" || process.platform === "win32") && input.cudaAvailable;
  }
  return false;
}

function getDescriptorSupportHint(input: {
  descriptor: NonNullable<ReturnType<typeof getSpeechToTextModelDescriptor>>;
  runtimeTarget: Awaited<ReturnType<typeof resolveRuntimePlatformTarget>>;
  cudaAvailable: boolean;
}): string | null {
  if (isDescriptorSupportedOnRuntime(input)) {
    return null;
  }
  if (input.descriptor.engineKind === "faster-whisper") {
    return "Requires an NVIDIA GPU with CUDA support.";
  }
  if (input.descriptor.engineKind === "parakeet-nemo") {
    return "Requires an NVIDIA GPU with CUDA and Python NeMo runtime support.";
  }
  if (input.runtimeTarget.engineId === "whisper.cpp-metal") {
    return "Requires local whisper.cpp Metal runtime support on Apple Silicon.";
  }
  return `Not supported on ${input.runtimeTarget.displayName}.`;
}

function createFinalMetrics(input: { session: SpeechToTextSessionRecord; decodeMs: number }) {
  return {
    recordedAudioMs: input.session.totalAudioMs,
    transportDrainMs:
      input.session.stopRequestedAtMs !== null && input.session.lastAppendCompletedAtMs !== null
        ? Math.max(0, input.session.lastAppendCompletedAtMs - input.session.stopRequestedAtMs)
        : 0,
    totalFinalizeMs: input.decodeMs,
    finalSttMs: input.session.finalSttMsTotal,
    cleanupMs: input.session.cleanupMsTotal,
    totalChunks: input.session.nextSequence,
    totalBatches: input.session.totalBatches,
    engine: input.session.engine,
    cleanupBackend: input.session.cleanupBackend,
    cleanupModel: input.session.cleanupModel,
  };
}

function createSessionRecord(input: {
  id: string;
  selectedModelId: string;
  engine: string;
  resources: SpeechToTextResolvedResources;
}): SpeechToTextSessionRecord {
  return {
    id: input.id,
    startedAt: Date.now(),
    engine: input.engine,
    settings: input.resources.settings,
    selectedModelId: input.selectedModelId,
    language: input.resources.language,
    prompt: input.resources.prompt,
    primaryResources: input.resources,
    nextSequence: 0,
    totalAudioMs: 0,
    totalBatches: 0,
    isStopping: false,
    sessionAudioBuffers: [],
    completionPublished: false,
    stopRequestedAtMs: null,
    lastAppendCompletedAtMs: null,
    finalTranscript: null,
    finalSttMsTotal: 0,
    cleanupMsTotal: 0,
    finalSttPassCount: 0,
    cleanupBackend: null,
    cleanupModel: null,
    finalizeChain: Promise.resolve(),
    lastError: null,
  };
}

export const makeSpeechToText = Effect.gen(function* () {
  const { stateDir, mode, host, cwd } = yield* ServerConfig;
  const textGeneration = yield* TextGeneration;
  const paths = resolveSpeechToTextPaths(stateDir);
  const configStore = createSpeechToTextConfigStore(paths.configPath);
  const stateChangesPubSub = yield* PubSub.unbounded<SpeechToTextState>();
  const sessionEventsPubSub = yield* PubSub.unbounded<SpeechToTextSessionEvent>();
  const downloadMutex = createAsyncMutex();
  const transcriptionMutex = createAsyncMutex();
  const sidecar = createWhisperSidecarManager();
  const pythonSidecar = createPythonSidecarManager();
  const runtimeTargetPromise = resolveRuntimePlatformTarget();
  const cudaAvailablePromise = detectSpeechToTextCudaAvailability();
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
      fs.mkdir(paths.backendsDir, { recursive: true }),
      fs.mkdir(paths.pythonRuntimeDir, { recursive: true }),
      fs.mkdir(paths.pythonModelsDir, { recursive: true }),
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
    const runtimeTarget = await runtimeTargetPromise;
    const cudaAvailable = await cudaAvailablePromise;
    const selectedDescriptor = config.selectedModelId
      ? getSpeechToTextModelDescriptor(config.selectedModelId)
      : null;

    let runtimeStatus: SpeechToTextState["runtimeStatus"] = "missing";
    if (!available) {
      runtimeStatus = "missing";
    } else if (mutableState.activeDownload?.type === "runtime") {
      runtimeStatus = "downloading";
    } else if (mutableState.runtimeErrorMessage) {
      runtimeStatus = "error";
    } else if (selectedDescriptor?.engineKind === "whisper.cpp" || !selectedDescriptor) {
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
      runtimeStatus = runtimeBinaryPath && runtimeCompatible ? "ready" : "missing";
    } else {
      runtimeStatus = (await isPythonBackendReady({
        paths,
        backend: resolvePythonBackendKind(selectedDescriptor.engineKind),
      }))
        ? "ready"
        : "missing";
    }

    const runtimeBackend = selectedDescriptor?.engineKind ?? runtimeTarget.engineId;
    const runtimeAcceleration = selectedDescriptor
      ? resolveRuntimeAccelerationForDescriptor({
          descriptor: selectedDescriptor,
          runtimeTarget,
          cudaAvailable,
        })
      : runtimeTarget.acceleration;
    const runtimeDevice =
      selectedDescriptor?.engineKind && selectedDescriptor.engineKind !== "whisper.cpp"
        ? runtimeAcceleration === "cuda"
          ? process.platform === "linux"
            ? "Python GPU (CUDA Linux)"
            : "Python GPU"
          : "Python CPU"
        : runtimeTarget.displayName;

    const catalog = SPEECH_TO_TEXT_MODEL_CATALOG.map((entry) => {
      const descriptor = getSpeechToTextModelDescriptor(entry.id);
      if (!descriptor) {
        return entry;
      }
      const supportedOnCurrentSystem = isDescriptorSupportedOnRuntime({
        descriptor,
        runtimeTarget,
        cudaAvailable,
      });
      return Object.assign({}, entry, {
        supportedOnCurrentSystem,
        supportHint: getDescriptorSupportHint({
          descriptor,
          runtimeTarget,
          cudaAvailable,
        }),
      });
    });

    const runtimeErrorMessage =
      selectedDescriptor &&
      !isDescriptorSupportedOnRuntime({
        descriptor: selectedDescriptor,
        runtimeTarget,
        cudaAvailable,
      })
        ? `${selectedDescriptor.name} is not supported on ${runtimeTarget.displayName}.`
        : null;

    return {
      available,
      runtimeStatus: runtimeErrorMessage ? "error" : runtimeStatus,
      runtimeBackend,
      runtimeAcceleration,
      runtimeDevice,
      selectedModelId: config.selectedModelId,
      installedModels,
      catalog,
      activeDownload: mutableState.activeDownload,
      settings: config.settings,
      errorMessage:
        runtimeErrorMessage ??
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
    const runtimeTarget = await runtimeTargetPromise;
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
      if (runtimeTarget.installKind === "source-build") {
        await buildMetalRuntimeFromSource({
          sourceDir: extractDir,
          outputDir: path.join(extractDir, "built-runtime"),
        });
      }
      const installSourceDir =
        runtimeTarget.installKind === "source-build"
          ? path.join(extractDir, "built-runtime")
          : extractDir;
      const extractedBinaryPath = await resolveInstalledRuntimeBinaryPath(
        installSourceDir,
        runtimeTarget.binaryName,
      );
      if (!extractedBinaryPath) {
        throw new Error("Downloaded whisper.cpp runtime did not contain whisper-cli.");
      }

      await ensureRuntimeBinaryPermissions(extractedBinaryPath);
      await writeRuntimeInstallationMetadata(path.join(installSourceDir, "runtime-manifest.json"), {
        assetName: asset.name,
        tagName,
      });
      await fs.rm(paths.runtimePlatformDir, { recursive: true, force: true });
      await fs.rename(installSourceDir, paths.runtimePlatformDir);
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

    const descriptor = getSpeechToTextModelDescriptor(modelId);
    if (!descriptor) {
      throw new Error("Selected speech-to-text model is no longer supported.");
    }
    const runtimeTarget = await runtimeTargetPromise;
    const cudaAvailable = await cudaAvailablePromise;
    if (!isDescriptorSupportedOnRuntime({ descriptor, runtimeTarget, cudaAvailable })) {
      throw new Error(`${descriptor.name} is not supported on ${runtimeTarget.displayName}.`);
    }

    const modelPath = path.join(paths.modelsDir, descriptor.fileName);
    if (!(await artifactExists(modelPath))) {
      throw new Error("Selected speech-to-text model is not installed.");
    }

    let sidecarBinaryPath: string | null = null;
    if (descriptor.engineKind === "whisper.cpp") {
      await downloadMutex.run(() => ensureRuntimeInstalledInternal());
      sidecarBinaryPath = await resolveInstalledRuntimeBinaryPath(
        paths.runtimePlatformDir,
        resolveWhisperSidecarBinaryName(),
      );
      if (!sidecarBinaryPath) {
        throw new Error("Installed whisper.cpp runtime does not include whisper-server.");
      }
    } else {
      await downloadMutex.run(() =>
        ensurePythonBackendReady({
          paths,
          backend: resolvePythonBackendKind(descriptor.engineKind),
        }),
      );
    }
    const language = getLanguageForModel(settings, modelId);
    const prompt = getPromptForSettings(settings);
    const vadModelPath = shouldUseSidecarVad(settings)
      ? await downloadMutex.run(() => ensureVadModelInstalled({ paths }))
      : undefined;

    return {
      family: descriptor.family,
      artifactKind: descriptor.artifactKind,
      engineKind: descriptor.engineKind,
      sidecarBinaryPath,
      modelId: descriptor.id,
      modelName: descriptor.name,
      modelRef: descriptor.modelRef,
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

  const queueWarmup = async (): Promise<void> => {
    if (warmupInFlight) {
      return warmupInFlight;
    }

    warmupInFlight = (async () => {
      try {
        const resources = await resolveSelectedModelResources();
        const runtimeTarget = await runtimeTargetPromise;
        const cudaAvailable = await cudaAvailablePromise;
        if (!resources.settings.warmupEnabled) {
          return;
        }

        if (resources.engineKind === "whisper.cpp") {
          if (!resources.sidecarBinaryPath) {
            throw new Error("whisper.cpp backend is missing whisper-server.");
          }
          await sidecar.ensureStarted({
            binaryPath: resources.sidecarBinaryPath,
            modelPath: resources.modelPath,
            threads: resources.threads,
            acceleration: runtimeTarget.acceleration,
            useVad: shouldUseSidecarVad(resources.settings),
            vadModelPath: resources.vadModelPath,
            tmpDir: paths.tmpDir,
          });
          await sidecar.warm({
            config: {
              binaryPath: resources.sidecarBinaryPath,
              modelPath: resources.modelPath,
              threads: resources.threads,
              acceleration: runtimeTarget.acceleration,
              useVad: shouldUseSidecarVad(resources.settings),
              vadModelPath: resources.vadModelPath,
              tmpDir: paths.tmpDir,
            },
            language: resources.language,
            prompt: resources.prompt,
            qualityProfile: resources.settings.qualityProfile,
          });
          return;
        }

        const { pythonPath } = await ensurePythonBackendReady({
          paths,
          backend: resolvePythonBackendKind(resources.engineKind),
          useCuda:
            resolveRuntimeAccelerationForDescriptor({
              descriptor: getSpeechToTextModelDescriptor(resources.modelId)!,
              runtimeTarget,
              cudaAvailable,
            }) === "cuda",
        });
        const pythonSidecarScriptPath = await ensurePythonSidecarScriptInstalled(paths);
        await pythonSidecar.ensureStarted({
          pythonPath,
          scriptPath: pythonSidecarScriptPath,
          backend: resolvePythonBackendKind(resources.engineKind),
          modelPath: resources.modelPath,
          modelRef: resources.modelRef,
          device: resolvePythonDevice(
            resolveRuntimeAccelerationForDescriptor({
              descriptor: getSpeechToTextModelDescriptor(resources.modelId)!,
              runtimeTarget,
              cudaAvailable,
            }),
          ),
          computeType: resolvePythonComputeType({
            engineKind: resources.engineKind,
            acceleration: resolveRuntimeAccelerationForDescriptor({
              descriptor: getSpeechToTextModelDescriptor(resources.modelId)!,
              runtimeTarget,
              cudaAvailable,
            }),
            qualityProfile: resources.settings.qualityProfile,
          }),
        });
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
      if (input.resources.engineKind === "whisper.cpp") {
        if (!input.resources.sidecarBinaryPath) {
          throw new Error("whisper.cpp backend is missing whisper-server.");
        }
        const runtimeTarget = await runtimeTargetPromise;
        return await sidecar.transcribe({
          config: {
            binaryPath: input.resources.sidecarBinaryPath,
            modelPath: input.resources.modelPath,
            threads: input.resources.threads,
            acceleration: runtimeTarget.acceleration,
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
      }

      const runtimeTarget = await runtimeTargetPromise;
      const cudaAvailable = await cudaAvailablePromise;
      const pythonAcceleration = resolveRuntimeAccelerationForDescriptor({
        descriptor: getSpeechToTextModelDescriptor(input.resources.modelId)!,
        runtimeTarget,
        cudaAvailable,
      });
      const { pythonPath } = await ensurePythonBackendReady({
        paths,
        backend: resolvePythonBackendKind(input.resources.engineKind),
        useCuda: pythonAcceleration === "cuda",
      });
      const pythonSidecarScriptPath = await ensurePythonSidecarScriptInstalled(paths);
      return await pythonSidecar.transcribe({
        config: {
          pythonPath,
          scriptPath: pythonSidecarScriptPath,
          backend: resolvePythonBackendKind(input.resources.engineKind),
          modelPath: input.resources.modelPath,
          modelRef: input.resources.modelRef,
          device: resolvePythonDevice(pythonAcceleration),
          computeType: resolvePythonComputeType({
            engineKind: input.resources.engineKind,
            acceleration: pythonAcceleration,
            qualityProfile: input.qualityProfile,
          }),
        },
        wavBase64: createWavBufferFromPcmChunks(input.buffers).toString("base64"),
        language: input.resources.language,
        prompt: input.resources.prompt,
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

  const queueSessionCompletion = (session: SpeechToTextSessionRecord): void => {
    session.finalizeChain = session.finalizeChain.then(async () => {
      const latest = sessions.get(session.id);
      if (!latest || latest.completionPublished) {
        return;
      }

      let finalText = "";
      let finalStage: SpeechToTextSessionFinalEvent["stage"] = "rawFinal";
      let cleanupFailed = false;

      if (latest.sessionAudioBuffers.length > 0) {
        try {
          await publishSessionEvent({
            type: "processing",
            sessionId: latest.id,
            phase: "transcribing",
          });
          const sttResult = await transcriptionMutex.run(() =>
            transcribeWithResources({
              resources: latest.primaryResources,
              buffers: latest.sessionAudioBuffers,
              qualityProfile: latest.primaryResources.settings.qualityProfile,
            }),
          );
          const refinedText = sttResult.text.trim();
          latest.finalSttPassCount += 1;
          latest.finalSttMsTotal += sttResult.decodeMs;
          if (refinedText.length > 0) {
            finalText = refinedText;
            finalStage = "rawFinal";
          }
        } catch (error) {
          latest.lastError =
            error instanceof Error ? error.message : "Speech transcription failed.";
        }
      }

      if (
        latest.settings.refinementMode === "refine-on-stop" &&
        finalText.length > 0 &&
        latest.lastError === null
      ) {
        const cleanupStartedAt = Date.now();
        try {
          await publishSessionEvent({
            type: "processing",
            sessionId: latest.id,
            phase: "cleaningUp",
          });
          const cleanupResult = await cleanupTranscriptWithLlm({
            textGeneration,
            cwd,
            transcript: finalText,
            language: latest.language,
            prompt: latest.prompt,
            model: latest.settings.cleanupModel ?? undefined,
          });
          latest.cleanupMsTotal += Date.now() - cleanupStartedAt;
          latest.cleanupBackend = cleanupResult.cleanupBackend;
          latest.cleanupModel = cleanupResult.cleanupModel;
          const cleanedText = cleanupResult.cleanedTranscript.trim();
          if (cleanedText.length > 0) {
            finalText = cleanedText;
            finalStage = "cleanedFinal";
          }
        } catch (error) {
          cleanupFailed = true;
          latest.cleanupMsTotal += Date.now() - cleanupStartedAt;
          latest.cleanupBackend = latest.settings.cleanupModel ? "attempted" : null;
          latest.cleanupModel = latest.settings.cleanupModel ?? null;
          latest.lastError = error instanceof Error ? error.message : "Transcript cleanup failed.";
          console.warn("[speech-to-text] cleanup failed", {
            sessionId: latest.id,
            cleanupModel: latest.settings.cleanupModel,
            reason: latest.lastError,
          });
        }
      }

      latest.finalTranscript = finalText.length > 0 ? finalText : null;
      latest.completionPublished = true;

      if (latest.finalTranscript) {
        const metrics = createFinalMetrics({
          session: latest,
          decodeMs: latest.finalSttMsTotal + latest.cleanupMsTotal,
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
          message:
            latest.lastError && !cleanupFailed
              ? latest.lastError
              : (latest.lastError ?? "No speech was detected in the recording."),
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
    session.sessionAudioBuffers.push(decodePcmBase64(chunkInput.pcmBase64));
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
          void pythonSidecar.stop();
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
          const descriptor = getSpeechToTextModelDescriptor(entry.id);
          if (!descriptor) {
            throw new Error(`Unknown speech-to-text model: ${entry.id}`);
          }
          const runtimeTarget = await runtimeTargetPromise;
          const cudaAvailable = await cudaAvailablePromise;
          if (!isDescriptorSupportedOnRuntime({ descriptor, runtimeTarget, cudaAvailable })) {
            throw new Error(`${descriptor.name} is not supported on ${runtimeTarget.displayName}.`);
          }
          if (descriptor.engineKind === "whisper.cpp") {
            await ensureRuntimeInstalledInternal();
          } else {
            mutableState.activeDownload = {
              type: "runtime",
              phase: "downloading-runtime",
              downloadedBytes: 0,
              totalBytes: null,
              message: `Preparing ${descriptor.engineKind} runtime`,
            };
            await publishState();
            await ensurePythonBackendReady({
              paths,
              backend: resolvePythonBackendKind(descriptor.engineKind),
              useCuda:
                resolveRuntimeAccelerationForDescriptor({
                  descriptor,
                  runtimeTarget,
                  cudaAvailable,
                }) === "cuda",
            });
            mutableState.activeDownload = null;
            await publishState();
          }

          const installedPath = path.join(paths.modelsDir, entry.fileName);
          if (await artifactExists(installedPath)) {
            mutableState.errorMessage = null;
            return publishState();
          }

          const downloadPath = path.join(
            paths.downloadsDir,
            `${entry.fileName}.${Date.now()}.download`,
          );
          const modelDownload = resolveSpeechToTextModelDownload(entry.id);
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
            if (modelDownload.kind === "direct-url") {
              await downloadFileToPath({
                url: modelDownload.source,
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
            } else {
              const descriptor = getSpeechToTextModelDescriptor(entry.id);
              await downloadPythonFamilyModel({
                paths,
                backend: resolvePythonBackendKind(descriptor?.engineKind ?? "faster-whisper"),
                repoId: modelDownload.source,
                destinationPath: installedPath,
                useCuda: Boolean(
                  descriptor &&
                  resolveRuntimeAccelerationForDescriptor({
                    descriptor,
                    runtimeTarget,
                    cudaAvailable,
                  }) === "cuda",
                ),
              });
            }
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
          .rm(path.join(paths.modelsDir, entry.fileName), { recursive: true, force: true })
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
        if (!(await artifactExists(modelPath))) {
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
      const runtimeTarget = await runtimeTargetPromise;
      const cudaAvailable = await cudaAvailablePromise;
      const descriptor = getSpeechToTextModelDescriptor(resources.modelId)!;
      const preferredAcceleration = resolveRuntimeAccelerationForDescriptor({
        descriptor,
        runtimeTarget,
        cudaAvailable,
      });
      if (resources.engineKind === "whisper.cpp") {
        const sidecarBinaryPath = resources.sidecarBinaryPath;
        if (!sidecarBinaryPath) {
          throw new Error("whisper.cpp backend is missing whisper-server.");
        }
        void sidecar
          .ensureStarted({
            binaryPath: sidecarBinaryPath,
            modelPath: resources.modelPath,
            threads: resources.threads,
            acceleration: preferredAcceleration,
            useVad: shouldUseSidecarVad(resources.settings),
            vadModelPath: resources.vadModelPath,
            tmpDir: paths.tmpDir,
          })
          .then(() =>
            sidecar.warm({
              config: {
                binaryPath: sidecarBinaryPath,
                modelPath: resources.modelPath,
                threads: resources.threads,
                acceleration: preferredAcceleration,
                useVad: shouldUseSidecarVad(resources.settings),
                vadModelPath: resources.vadModelPath,
                tmpDir: paths.tmpDir,
              },
              language: resources.language,
              prompt: resources.prompt,
              qualityProfile: resources.settings.qualityProfile,
            }),
          )
          .catch((error) => {
            console.warn("[speech-to-text] backend warmup failed", {
              sessionModel: resources.modelId,
              engine: resources.engineKind,
              reason: error instanceof Error ? error.message : String(error),
            });
          });
      } else {
        const { pythonPath } = await ensurePythonBackendReady({
          paths,
          backend: resolvePythonBackendKind(resources.engineKind),
          useCuda: preferredAcceleration === "cuda",
        });
        const pythonSidecarScriptPath = await ensurePythonSidecarScriptInstalled(paths);
        void pythonSidecar
          .ensureStarted({
            pythonPath,
            scriptPath: pythonSidecarScriptPath,
            backend: resolvePythonBackendKind(resources.engineKind),
            modelPath: resources.modelPath,
            modelRef: resources.modelRef,
            device: resolvePythonDevice(preferredAcceleration),
            computeType: resolvePythonComputeType({
              engineKind: resources.engineKind,
              acceleration: preferredAcceleration,
              qualityProfile: resources.settings.qualityProfile,
            }),
          })
          .catch((error) => {
            console.warn("[speech-to-text] backend warmup failed", {
              sessionModel: resources.modelId,
              engine: resources.engineKind,
              reason: error instanceof Error ? error.message : String(error),
            });
          });
      }
      const sessionId = randomUUID();
      const session = createSessionRecord({
        id: sessionId,
        selectedModelId: resources.modelId,
        engine:
          resources.engineKind === "whisper.cpp" ? runtimeTarget.engineId : resources.engineKind,
        resources,
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
