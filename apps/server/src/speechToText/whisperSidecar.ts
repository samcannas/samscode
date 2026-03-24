import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createWavBufferFromPcmChunks } from "./pcmWav";

interface WhisperSidecarInferenceInput {
  readonly wavBuffer: Buffer;
  readonly language: string;
  readonly prompt: string;
  readonly qualityProfile: "fast" | "balanced" | "quality";
}

interface WhisperSidecarSessionConfig {
  readonly binaryPath: string;
  readonly modelPath: string;
  readonly threads: number;
  readonly acceleration: "cpu" | "cuda" | "metal";
  readonly useVad: boolean;
  readonly vadModelPath: string | undefined;
  readonly tmpDir: string;
}

interface WhisperServerJsonOutput {
  readonly text?: string;
  readonly segments?: ReadonlyArray<{
    readonly text?: string;
  }>;
}

interface WhisperSidecarInstance {
  readonly child: ChildProcessWithoutNullStreams;
  readonly baseUrl: string;
  readonly configFingerprint: string;
  stderr: string;
}

const warmedFingerprints = new Set<string>();

function getWhisperServerBinaryName(): string {
  return process.platform === "win32" ? "whisper-server.exe" : "whisper-server";
}

function killChild(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // fall through to direct kill
    }
  }
  child.kill("SIGTERM");
}

function parseTranscriptFromJson(payload: WhisperServerJsonOutput): string {
  if (typeof payload.text === "string" && payload.text.trim().length > 0) {
    return payload.text.trim();
  }

  if (!Array.isArray(payload.segments)) {
    return "";
  }

  return payload.segments
    .map((segment) => (typeof segment.text === "string" ? segment.text.trim() : ""))
    .filter((text) => text.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getThreadsArg(threads: number): string {
  return String(Math.max(1, threads));
}

function buildSidecarArgs(config: WhisperSidecarSessionConfig, port: number): string[] {
  const args = [
    "-m",
    config.modelPath,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "-t",
    getThreadsArg(config.threads),
    "-nf",
    "-nt",
    "-sns",
    "--tmp-dir",
    config.tmpDir,
  ];

  if (config.acceleration === "cpu") {
    args.push("-ng", "-nfa");
  } else {
    args.push("-fa");
  }

  if (config.useVad && config.vadModelPath) {
    args.push("--vad", "-vm", config.vadModelPath);
  }

  return args;
}

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to reserve a local port for speech-to-text.")));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForSidecarReady(instance: WhisperSidecarInstance): Promise<void> {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (instance.child.exitCode !== null) {
      const stderr = instance.stderr.trim();
      throw new Error(
        `Speech-to-text sidecar exited before becoming ready${stderr ? `: ${stderr}` : "."}`,
      );
    }

    try {
      const response = await fetch(`${instance.baseUrl}/`, {
        method: "GET",
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // sidecar is still booting
    }

    await delay(200);
  }

  killChild(instance.child);
  throw new Error("Speech-to-text sidecar did not become ready in time.");
}

function buildInferenceForm(input: WhisperSidecarInferenceInput): FormData {
  const form = new FormData();
  form.set("file", new Blob([input.wavBuffer], { type: "audio/wav" }), "speech.wav");
  form.set("response_format", "json");
  form.set("temperature", input.qualityProfile === "quality" ? "0.0" : "0.0");
  form.set("temperature_inc", "0.0");

  if (input.qualityProfile === "quality") {
    form.set("beam_size", "3");
    form.set("best_of", "2");
  } else if (input.qualityProfile === "fast") {
    form.set("best_of", "1");
  } else {
    form.set("best_of", "1");
  }

  if (input.language === "auto") {
    form.set("detect_language", "true");
  } else {
    form.set("language", input.language);
  }

  if (input.prompt.trim().length > 0) {
    form.set("prompt", input.prompt.trim());
  }

  return form;
}

function getFingerprint(config: WhisperSidecarSessionConfig): string {
  return JSON.stringify({
    binaryPath: config.binaryPath,
    modelPath: config.modelPath,
    threads: config.threads,
    acceleration: config.acceleration,
    useVad: config.useVad,
    vadModelPath: config.vadModelPath ?? null,
  });
}

export function createWhisperSidecarManager() {
  const instances = new Map<string, WhisperSidecarInstance>();
  const ensurePromises = new Map<string, Promise<WhisperSidecarInstance>>();

  const stopInstance = async (current: WhisperSidecarInstance): Promise<void> => {
    instances.delete(current.configFingerprint);
    ensurePromises.delete(current.configFingerprint);
    warmedFingerprints.delete(current.configFingerprint);
    killChild(current.child);
    await Promise.race([
      new Promise<void>((resolve) => {
        current.child.once("exit", () => resolve());
      }),
      delay(2_000).then(() => undefined),
    ]);
  };

  const stop = async (): Promise<void> => {
    const activeInstances = [...instances.values()];
    await Promise.all(activeInstances.map((current) => stopInstance(current)));
  };

  const ensureStarted = async (
    config: WhisperSidecarSessionConfig,
  ): Promise<WhisperSidecarInstance> => {
    const configFingerprint = getFingerprint(config);

    const existing = instances.get(configFingerprint);
    if (existing && existing.child.exitCode === null) {
      return existing;
    }

    const existingPromise = ensurePromises.get(configFingerprint);
    if (existingPromise) {
      await existingPromise;
      const ready = instances.get(configFingerprint);
      if (ready && ready.child.exitCode === null) {
        return ready;
      }
    }

    const ensurePromise = (async () => {
      const port = await reservePort();
      const args = buildSidecarArgs(config, port);
      const child = spawn(config.binaryPath, args, {
        stdio: "pipe",
        windowsHide: true,
        shell: false,
        cwd: path.dirname(config.binaryPath),
      });
      const spawnErrorPromise = new Promise<never>((_, reject) => {
        child.once("error", (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });

      const nextInstance: WhisperSidecarInstance = {
        child,
        baseUrl: `http://127.0.0.1:${port}`,
        configFingerprint,
        stderr: "",
      };

      child.stderr.on("data", (chunk: Buffer | string) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        nextInstance.stderr = `${nextInstance.stderr}${text}`.slice(-8_192);
      });

      child.once("exit", () => {
        instances.delete(nextInstance.configFingerprint);
        warmedFingerprints.delete(nextInstance.configFingerprint);
      });

      await Promise.race([waitForSidecarReady(nextInstance), spawnErrorPromise]);
      instances.set(configFingerprint, nextInstance);
      return nextInstance;
    })();
    ensurePromises.set(configFingerprint, ensurePromise);

    try {
      return await ensurePromise;
    } finally {
      ensurePromises.delete(configFingerprint);
    }
  };

  const transcribe = async (input: {
    readonly config: WhisperSidecarSessionConfig;
    readonly inference: WhisperSidecarInferenceInput;
  }): Promise<{ text: string; decodeMs: number }> => {
    const sendInference = async (): Promise<{ text: string; decodeMs: number }> => {
      const current = await ensureStarted(input.config);
      const startedAt = performance.now();
      const response = await fetch(`${current.baseUrl}/inference`, {
        method: "POST",
        body: buildInferenceForm(input.inference),
        signal: AbortSignal.timeout(10 * 60_000),
      });

      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).trim();
        throw new Error(
          `whisper sidecar inference failed (${response.status})${detail ? `: ${detail}` : ""}`,
        );
      }

      const payload = (await response.json()) as WhisperServerJsonOutput;
      return {
        text: parseTranscriptFromJson(payload),
        decodeMs: Math.round(performance.now() - startedAt),
      };
    };

    try {
      return await sendInference();
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      if (error.message.startsWith("whisper sidecar inference failed (")) {
        throw error;
      }
      await stop();
      return sendInference();
    }
  };

  return {
    stop,
    ensureStarted,
    warm: async (input: {
      readonly config: WhisperSidecarSessionConfig;
      readonly language: string;
      readonly prompt: string;
      readonly qualityProfile: "fast" | "balanced" | "quality";
    }) => {
      const current = await ensureStarted(input.config);
      if (warmedFingerprints.has(current.configFingerprint)) {
        return;
      }

      const silenceWav = createWavBufferFromPcmChunks([Buffer.alloc(16_000)]);

      try {
        await transcribe({
          config: input.config,
          inference: {
            wavBuffer: silenceWav,
            language: input.language,
            prompt: input.prompt,
            qualityProfile: input.qualityProfile,
          },
        });
      } catch {
        // Best effort only.
      }

      warmedFingerprints.add(current.configFingerprint);
    },
    transcribe,
  };
}

export function resolveWhisperSidecarBinaryName(): string {
  return getWhisperServerBinaryName();
}
