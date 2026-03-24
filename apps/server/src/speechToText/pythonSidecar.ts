import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import type { PythonBackendKind } from "./pythonRuntime";

interface PythonSidecarConfig {
  readonly pythonPath: string;
  readonly scriptPath: string;
  readonly backend: PythonBackendKind;
  readonly modelPath: string;
  readonly modelRef?: string | undefined;
  readonly device: "cpu" | "cuda";
  readonly computeType?: string | undefined;
}

interface PythonSidecarInstance {
  readonly child: ChildProcessWithoutNullStreams;
  readonly baseUrl: string;
  readonly fingerprint: string;
  stderr: string;
}

function killChild(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // fall through
    }
  }
  child.kill("SIGTERM");
}

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Unable to reserve a local port for Python STT sidecar.")),
        );
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

function getFingerprint(config: PythonSidecarConfig): string {
  return JSON.stringify(config);
}

async function waitForReady(instance: PythonSidecarInstance): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (instance.child.exitCode !== null) {
      throw new Error(
        `Python STT sidecar exited before becoming ready${instance.stderr.trim() ? `: ${instance.stderr.trim()}` : "."}`,
      );
    }

    try {
      const response = await fetch(`${instance.baseUrl}/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // booting
    }

    await delay(200);
  }

  killChild(instance.child);
  throw new Error("Python STT sidecar did not become ready in time.");
}

export function createPythonSidecarManager() {
  const instances = new Map<string, PythonSidecarInstance>();
  const ensurePromises = new Map<string, Promise<PythonSidecarInstance>>();

  const stop = async (): Promise<void> => {
    const activeInstances = [...instances.values()];
    await Promise.all(
      activeInstances.map(async (instance) => {
        instances.delete(instance.fingerprint);
        ensurePromises.delete(instance.fingerprint);
        killChild(instance.child);
        await Promise.race([
          new Promise<void>((resolve) => instance.child.once("exit", () => resolve())),
          delay(2_000).then(() => undefined),
        ]);
      }),
    );
  };

  const ensureStarted = async (config: PythonSidecarConfig): Promise<PythonSidecarInstance> => {
    const fingerprint = getFingerprint(config);
    const existing = instances.get(fingerprint);
    if (existing && existing.child.exitCode === null) {
      return existing;
    }

    const existingPromise = ensurePromises.get(fingerprint);
    if (existingPromise) {
      return existingPromise;
    }

    const ensurePromise = (async () => {
      const pythonExists = (await fs.stat(config.pythonPath).catch(() => null))?.isFile() ?? false;
      if (!pythonExists) {
        throw new Error(`Python STT executable not found: ${config.pythonPath}`);
      }
      const port = await reservePort();
      const args = [
        config.scriptPath,
        "serve",
        "--backend",
        config.backend,
        "--model-path",
        config.modelPath,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--device",
        config.device,
      ];
      if (config.modelRef) {
        args.push("--model-ref", config.modelRef);
      }
      if (config.computeType) {
        args.push("--compute-type", config.computeType);
      }

      const child = spawn(config.pythonPath, args, {
        stdio: "pipe",
        windowsHide: true,
        shell: false,
        cwd: path.dirname(config.scriptPath),
      });
      const spawnErrorPromise = new Promise<never>((_, reject) => {
        child.once("error", (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });

      const instance: PythonSidecarInstance = {
        child,
        baseUrl: `http://127.0.0.1:${port}`,
        fingerprint,
        stderr: "",
      };
      child.stderr.on("data", (chunk: Buffer | string) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        instance.stderr = `${instance.stderr}${text}`.slice(-8_192);
      });
      child.once("exit", () => {
        instances.delete(fingerprint);
      });

      await Promise.race([waitForReady(instance), spawnErrorPromise]);
      instances.set(fingerprint, instance);
      return instance;
    })();

    ensurePromises.set(fingerprint, ensurePromise);
    try {
      return await ensurePromise;
    } finally {
      ensurePromises.delete(fingerprint);
    }
  };

  const transcribe = async (input: {
    readonly config: PythonSidecarConfig;
    readonly wavBase64: string;
    readonly language: string;
    readonly prompt: string;
  }): Promise<{ text: string; decodeMs: number }> => {
    const instance = await ensureStarted(input.config);
    const startedAt = performance.now();
    const response = await fetch(`${instance.baseUrl}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audio_base64: input.wavBase64,
        language: input.language,
        prompt: input.prompt,
      }),
      signal: AbortSignal.timeout(10 * 60_000),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim();
      throw new Error(
        `Python STT sidecar inference failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    const payload = (await response.json()) as { text?: unknown };
    return {
      text: typeof payload.text === "string" ? payload.text.trim() : "",
      decodeMs: Math.round(performance.now() - startedAt),
    };
  };

  return { stop, ensureStarted, transcribe };
}
