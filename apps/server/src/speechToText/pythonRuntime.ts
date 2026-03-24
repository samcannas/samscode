import { promises as fs } from "node:fs";
import path from "node:path";

import type { SpeechToTextPaths } from "./types";
import { runProcess } from "../processRunner";

export type PythonBackendKind = "faster-whisper" | "parakeet-nemo";

interface PythonCommandCandidate {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

const PYTHON_COMMAND_CANDIDATES: ReadonlyArray<PythonCommandCandidate> = [
  ...(process.platform === "win32"
    ? ([
        { command: "py", args: ["-3"] },
        { command: "python", args: [] },
      ] satisfies ReadonlyArray<PythonCommandCandidate>)
    : []),
  { command: "python3", args: [] },
  { command: "python", args: [] },
];

function getVenvPythonPath(venvDir: string): string {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function getVenvPipPath(venvDir: string): string {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "pip.exe")
    : path.join(venvDir, "bin", "pip");
}

async function fileExists(candidatePath: string): Promise<boolean> {
  return (await fs.stat(candidatePath).catch(() => null))?.isFile() ?? false;
}

async function resolveSystemPython(): Promise<PythonCommandCandidate> {
  for (const candidate of PYTHON_COMMAND_CANDIDATES) {
    try {
      const result = await runProcess(candidate.command, [...candidate.args, "--version"], {
        timeoutMs: 5_000,
        allowNonZeroExit: true,
      });
      if (result.code === 0) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    "Python 3.9+ is required for accelerated speech-to-text backends, but no Python executable was found.",
  );
}

async function ensureVirtualEnvironment(paths: SpeechToTextPaths): Promise<{
  pythonPath: string;
  pipPath: string;
}> {
  const pythonPath = getVenvPythonPath(paths.pythonVenvDir);
  const pipPath = getVenvPipPath(paths.pythonVenvDir);

  if ((await fileExists(pythonPath)) && (await fileExists(pipPath))) {
    return { pythonPath, pipPath };
  }

  await fs.mkdir(paths.pythonRuntimeDir, { recursive: true });
  const candidate = await resolveSystemPython();
  await runProcess(candidate.command, [...candidate.args, "-m", "venv", paths.pythonVenvDir], {
    timeoutMs: 120_000,
  });

  const pythonExists = await fileExists(pythonPath);
  const pipExists = await fileExists(pipPath);
  if (!pythonExists || !pipExists) {
    throw new Error(
      `Python virtual environment was created without expected executables (${pythonPath}, ${pipPath}).`,
    );
  }

  return { pythonPath, pipPath };
}

function backendInstallCommands(input: {
  backend: PythonBackendKind;
  useCuda: boolean;
}): ReadonlyArray<ReadonlyArray<string>> {
  if (input.backend === "faster-whisper") {
    return [["install", "faster-whisper", "huggingface-hub", "numpy"]];
  }

  if (input.useCuda) {
    return [
      ["install", "torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu124"],
      ["install", "nemo_toolkit[asr]", "huggingface-hub", "numpy"],
    ];
  }

  return [
    ["install", "torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cpu"],
    ["install", "nemo_toolkit[asr]", "huggingface-hub", "numpy"],
  ];
}

async function ensureBackendMarker(
  paths: SpeechToTextPaths,
  backend: PythonBackendKind,
): Promise<boolean> {
  const markerPath = path.join(paths.pythonRuntimeDir, `${backend}.ready.json`);
  return fileExists(markerPath);
}

export async function isPythonBackendReady(input: {
  paths: SpeechToTextPaths;
  backend: PythonBackendKind;
}): Promise<boolean> {
  const pythonPath = getVenvPythonPath(input.paths.pythonVenvDir);
  return (await fileExists(pythonPath)) && (await ensureBackendMarker(input.paths, input.backend));
}

async function writeBackendMarker(
  paths: SpeechToTextPaths,
  backend: PythonBackendKind,
): Promise<void> {
  const markerPath = path.join(paths.pythonRuntimeDir, `${backend}.ready.json`);
  await fs.writeFile(
    markerPath,
    `${JSON.stringify({ backend, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

export async function ensurePythonBackendReady(input: {
  paths: SpeechToTextPaths;
  backend: PythonBackendKind;
  useCuda?: boolean;
}): Promise<{ pythonPath: string }> {
  const { pythonPath, pipPath } = await ensureVirtualEnvironment(input.paths);
  const readyMarkerExists = await ensureBackendMarker(input.paths, input.backend);
  if (readyMarkerExists && (await fileExists(pythonPath))) {
    return { pythonPath };
  }
  if (readyMarkerExists && !(await fileExists(pythonPath))) {
    await fs
      .rm(path.join(input.paths.pythonRuntimeDir, `${input.backend}.ready.json`), { force: true })
      .catch(() => undefined);
  }

  await runProcess(pipPath, ["install", "--upgrade", "pip"], {
    timeoutMs: 10 * 60_000,
    allowNonZeroExit: true,
  });
  for (const installArgs of backendInstallCommands({
    backend: input.backend,
    useCuda: input.useCuda ?? false,
  })) {
    await runProcess(pipPath, [...installArgs], {
      timeoutMs: 30 * 60_000,
    });
  }
  await writeBackendMarker(input.paths, input.backend);
  return { pythonPath };
}

export async function downloadPythonFamilyModel(input: {
  paths: SpeechToTextPaths;
  backend: PythonBackendKind;
  repoId: string;
  destinationPath: string;
  useCuda?: boolean;
}): Promise<void> {
  const { pythonPath } = await ensurePythonBackendReady({
    paths: input.paths,
    backend: input.backend,
    ...(typeof input.useCuda === "boolean" ? { useCuda: input.useCuda } : {}),
  });
  const script = [
    "from huggingface_hub import snapshot_download",
    `snapshot_download(repo_id=${JSON.stringify(input.repoId)}, local_dir=${JSON.stringify(input.destinationPath)}, local_dir_use_symlinks=False)`,
  ].join("\n");
  await fs.mkdir(path.dirname(input.destinationPath), { recursive: true });
  await runProcess(pythonPath, ["-c", script], {
    timeoutMs: 30 * 60_000,
  });
}
