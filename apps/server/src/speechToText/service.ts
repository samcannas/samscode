import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  SpeechToTextInstalledModel,
  SpeechToTextState,
  SpeechToTextTranscriptionResult,
} from "@samscode/contracts";
import { Effect, PubSub, ServiceMap, Stream } from "effect";

import { ServerConfig } from "../config";
import { getSpeechToTextCatalogEntry, SPEECH_TO_TEXT_MODEL_CATALOG } from "./catalog";
import { createSpeechToTextConfigStore } from "./configStore";
import { downloadFileToPath } from "./downloadManager";
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
import type { SpeechToTextMutableState, SpeechToTextShape } from "./types";
import {
  assertSpeechToTextWavPayload,
  decodeSpeechToTextWavBase64,
  sanitizeSpeechToTextFileName,
} from "./wavInput";
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

export const makeSpeechToText = Effect.gen(function* () {
  const { stateDir, mode, host } = yield* ServerConfig;
  const paths = resolveSpeechToTextPaths(stateDir);
  const configStore = createSpeechToTextConfigStore(paths.configPath);
  const stateChangesPubSub = yield* PubSub.unbounded<SpeechToTextState>();
  const downloadMutex = createAsyncMutex();
  const transcriptionMutex = createAsyncMutex();
  const runtimeTarget = resolveRuntimePlatformTarget();
  const available =
    process.env.SAMSCODE_ENABLE_REMOTE_STT === "1" ||
    process.env.SAMSCODE_ENABLE_REMOTE_STT === "true" ||
    mode === "desktop" ||
    isLoopbackHost(host);
  let started = false;
  const mutableState: SpeechToTextMutableState = {
    activeDownload: null,
    errorMessage: null,
    runtimeErrorMessage: null,
  };

  const ensureDirectories = async (): Promise<void> => {
    await Promise.all([
      fs.mkdir(paths.rootDir, { recursive: true }),
      fs.mkdir(paths.modelsDir, { recursive: true }),
      fs.mkdir(paths.runtimeRootDir, { recursive: true }),
      fs.mkdir(paths.downloadsDir, { recursive: true }),
      fs.mkdir(paths.tmpDir, { recursive: true }),
    ]);
  };

  const resolveCurrentState = async (): Promise<SpeechToTextState> => {
    await ensureDirectories();
    const config = await configStore.load();
    const installedModels = await listInstalledModels(paths.modelsDir, config.selectedModelId);
    const selectedModelId = installedModels.some((entry) => entry.id === config.selectedModelId)
      ? config.selectedModelId
      : null;
    if (config.selectedModelId !== selectedModelId) {
      await configStore.save({ selectedModelId });
    }

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
      selectedModelId,
      installedModels,
      catalog: [...SPEECH_TO_TEXT_MODEL_CATALOG],
      activeDownload: mutableState.activeDownload,
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
            mutableState.activeDownload = null;
            mutableState.errorMessage = null;
            return publishState();
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
        const config = await configStore.load();
        if (config.selectedModelId === entry.id) {
          await configStore.save({ selectedModelId: null });
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

        await configStore.save({ selectedModelId: entry.id });
        mutableState.errorMessage = null;
        return publishState();
      }),
    transcribeWav: (input) =>
      Effect.tryPromise(() =>
        transcriptionMutex.run(async (): Promise<SpeechToTextTranscriptionResult> => {
          if (!available) {
            throw new Error("Speech-to-text is unavailable on this server.");
          }

          const snapshot = await resolveCurrentState();
          const selectedModelId = snapshot.selectedModelId;
          if (!selectedModelId) {
            throw new Error("Select a speech-to-text model first.");
          }

          const modelEntry = getSpeechToTextCatalogEntry(selectedModelId);
          if (!modelEntry) {
            throw new Error("Selected speech-to-text model is no longer supported.");
          }

          const modelPath = path.join(paths.modelsDir, modelEntry.fileName);
          if (!(await fileExists(modelPath))) {
            throw new Error("Selected speech-to-text model is not installed.");
          }

          const wavBytes = decodeSpeechToTextWavBase64(input.wavBase64);
          assertSpeechToTextWavPayload(wavBytes);
          const runtimeBinaryPath = await downloadMutex.run(() => ensureRuntimeInstalledInternal());
          const safeFileName = sanitizeSpeechToTextFileName(input.fileName);
          const wavPath = path.join(paths.tmpDir, `${Date.now()}-${safeFileName}`);
          const outputBasePath = path.join(paths.tmpDir, `${Date.now()}-whisper-output`);
          await fs.writeFile(wavPath, wavBytes);
          mutableState.errorMessage = null;

          try {
            const transcription = await transcribeWithWhisperCli({
              binaryPath: runtimeBinaryPath,
              modelPath,
              audioPath: wavPath,
              outputBasePath,
            });
            mutableState.errorMessage = null;
            await publishState();
            return {
              text: transcription.text,
              modelId: selectedModelId,
              elapsedMs: transcription.elapsedMs,
            };
          } catch (error) {
            const rawMessage =
              error instanceof Error ? error.message : "Speech transcription failed.";
            const message = normalizeWhisperCliErrorMessage(rawMessage, modelEntry.name);
            mutableState.errorMessage = message;
            await publishState();
            throw new Error(message, { cause: error });
          } finally {
            await fs.rm(wavPath, { force: true }).catch(() => undefined);
            await removeWhisperOutputFiles(outputBasePath);
          }
        }),
      ),
    get streamChanges() {
      return Stream.fromPubSub(stateChangesPubSub);
    },
  } satisfies SpeechToTextShape;
});
