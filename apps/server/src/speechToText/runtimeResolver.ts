import { promises as fs } from "node:fs";
import path from "node:path";

import { runProcess } from "../processRunner";
import type {
  RuntimeInstallationMetadata,
  RuntimePlatformTarget,
  RuntimeReleaseResponse,
  SpeechToTextPaths,
} from "./types";

const RUNTIME_MANIFEST_FILE_NAME = "runtime-manifest.json";

function resolveAccelerationPreference(): "auto" | "cpu" | "cuda" | "metal" {
  const raw = process.env.SAMSCODE_STT_ACCELERATION?.trim().toLowerCase();
  if (raw === "cpu" || raw === "cuda" || raw === "metal") {
    return raw;
  }
  return "auto";
}

export async function detectSpeechToTextCudaAvailability(): Promise<boolean> {
  if (!((process.platform === "win32" || process.platform === "linux") && process.arch === "x64")) {
    return false;
  }

  try {
    const result = await runProcess("nvidia-smi", ["-L"], {
      timeoutMs: 3_000,
      allowNonZeroExit: true,
    });
    return result.code === 0 && /GPU\s+\d+/i.test(result.stdout);
  } catch {
    return false;
  }
}

async function detectCommandAvailability(
  command: string,
  args: ReadonlyArray<string>,
): Promise<boolean> {
  try {
    const result = await runProcess(command, args, {
      timeoutMs: 5_000,
      allowNonZeroExit: true,
    });
    return result.code === 0;
  } catch {
    return false;
  }
}

export function resolveSpeechToTextPaths(stateDir: string): SpeechToTextPaths {
  const rootDir = path.join(stateDir, "speech-to-text");
  const runtimePlatformDir = path.join(rootDir, "runtime", `${process.platform}-${process.arch}`);
  const resourcesDir = path.join(rootDir, "resources");
  const backendsDir = path.join(rootDir, "backends");
  return {
    rootDir,
    configPath: path.join(rootDir, "config.json"),
    modelsDir: path.join(rootDir, "models"),
    resourcesDir,
    vadModelPath: path.join(resourcesDir, "ggml-silero-v5.1.2.bin"),
    backendsDir,
    pythonRuntimeDir: path.join(backendsDir, "python"),
    pythonVenvDir: path.join(backendsDir, "python", "venv"),
    pythonModelsDir: path.join(backendsDir, "python", "models"),
    runtimeRootDir: path.join(rootDir, "runtime"),
    runtimePlatformDir,
    runtimeManifestPath: path.join(runtimePlatformDir, RUNTIME_MANIFEST_FILE_NAME),
    downloadsDir: path.join(rootDir, "downloads"),
    tmpDir: path.join(rootDir, "tmp"),
  };
}

export async function resolveRuntimePlatformTarget(): Promise<RuntimePlatformTarget> {
  const preference = resolveAccelerationPreference();

  if (process.platform === "win32" && process.arch === "x64") {
    const useCuda =
      preference === "cuda" ||
      (preference === "auto" && (await detectSpeechToTextCudaAvailability()));
    return {
      platformKey: `${process.platform}-${process.arch}`,
      assetName: useCuda ? "whisper-cublas-12.4.0-bin-x64.zip" : "whisper-blas-bin-x64.zip",
      binaryName: "whisper-cli.exe",
      supported: true,
      displayName: useCuda ? "Windows x64 (CUDA)" : "Windows x64 (CPU BLAS)",
      engineId: useCuda ? "whisper.cpp-cuda" : "whisper.cpp-cpu",
      acceleration: useCuda ? "cuda" : "cpu",
      installKind: "archive",
    };
  }

  if (process.platform === "win32" && process.arch === "ia32") {
    return {
      platformKey: `${process.platform}-${process.arch}`,
      assetName: "whisper-blas-bin-Win32.zip",
      binaryName: "whisper-cli.exe",
      supported: true,
      displayName: "Windows x86 (CPU BLAS)",
      engineId: "whisper.cpp-cpu",
      acceleration: "cpu",
      installKind: "archive",
    };
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return {
      platformKey: `${process.platform}-${process.arch}`,
      assetName: "whisper-blas-bin-x64.zip",
      binaryName: "whisper-cli",
      supported: true,
      displayName: "Linux x64 (CPU BLAS)",
      engineId: "whisper.cpp-cpu",
      acceleration: "cpu",
      installKind: "archive",
    };
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    const canBuild =
      (await detectCommandAvailability("cmake", ["--version"])) &&
      (await detectCommandAvailability("xcodebuild", ["-version"]));
    return {
      platformKey: `${process.platform}-${process.arch}`,
      assetName: "whisper.cpp-source-build.zip",
      binaryName: "whisper-cli",
      supported: canBuild,
      displayName: "macOS Apple Silicon (Metal)",
      engineId: "whisper.cpp-metal",
      acceleration: "metal",
      installKind: "source-build",
    };
  }

  return {
    platformKey: `${process.platform}-${process.arch}`,
    assetName: "",
    binaryName: "whisper-cli",
    supported: false,
    displayName: `${process.platform} ${process.arch}`,
    engineId: "whisper.cpp-cpu",
    acceleration: "cpu",
    installKind: "archive",
  };
}

export async function resolveInstalledRuntimeBinaryPath(
  runtimePlatformDir: string,
  binaryName: string,
): Promise<string | null> {
  try {
    const directCandidate = path.join(runtimePlatformDir, binaryName);
    const directStat = await fs.stat(directCandidate).catch(() => null);
    if (directStat?.isFile()) {
      return directCandidate;
    }

    const stack = [runtimePlatformDir];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        if (entry.isFile() && entry.name === binaryName) {
          return entryPath;
        }
      }
    }

    const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    for (const entry of pathEntries) {
      const candidate = path.join(entry, binaryName);
      const candidateStat = await fs.stat(candidate).catch(() => null);
      if (candidateStat?.isFile()) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function readRuntimeInstallationMetadata(
  runtimeManifestPath: string,
): Promise<RuntimeInstallationMetadata | null> {
  try {
    const raw = await fs.readFile(runtimeManifestPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeInstallationMetadata>;
    if (typeof parsed.assetName !== "string" || typeof parsed.tagName !== "string") {
      return null;
    }
    return {
      assetName: parsed.assetName,
      tagName: parsed.tagName,
    };
  } catch {
    return null;
  }
}

export async function writeRuntimeInstallationMetadata(
  runtimeManifestPath: string,
  metadata: RuntimeInstallationMetadata,
): Promise<void> {
  await fs.writeFile(runtimeManifestPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export async function isRuntimeInstallationCompatible(input: {
  runtimeManifestPath: string;
  target: RuntimePlatformTarget;
}): Promise<boolean> {
  const metadata = await readRuntimeInstallationMetadata(input.runtimeManifestPath);
  if (metadata) {
    return metadata.assetName === input.target.assetName;
  }
  return input.target.platformKey !== "win32-x64";
}

export async function resolveRuntimeReleaseAsset(): Promise<{
  asset: { name: string; browser_download_url: string; size: number };
  tagName: string;
}> {
  const target = await resolveRuntimePlatformTarget();
  if (!target.supported) {
    throw new Error(`Speech-to-text runtime download is not supported on ${target.displayName}.`);
  }

  const response = await fetch(
    "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest",
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "Sam's Code",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Unable to fetch whisper.cpp releases (${response.status}).`);
  }

  const release = (await response.json()) as RuntimeReleaseResponse;
  if (target.installKind === "source-build") {
    return {
      asset: {
        name: target.assetName,
        browser_download_url: release.zipball_url,
        size: 0,
      },
      tagName: release.tag_name,
    };
  }

  const asset = release.assets.find((entry) => entry.name === target.assetName);
  if (!asset) {
    throw new Error(`No whisper.cpp runtime asset found for ${target.displayName}.`);
  }

  return { asset, tagName: release.tag_name };
}

export function buildRuntimeArchiveTempPath(downloadsDir: string, assetName: string): string {
  const parsedAsset = path.parse(assetName);
  const extension = parsedAsset.ext || ".zip";
  const baseName = parsedAsset.name || assetName;
  return path.join(downloadsDir, `${baseName}.${Date.now()}.tmp${extension}`);
}

function escapePowerShellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

export async function extractRuntimeArchive(input: {
  archivePath: string;
  destinationDir: string;
}): Promise<void> {
  await fs.rm(input.destinationDir, { recursive: true, force: true });
  await fs.mkdir(input.destinationDir, { recursive: true });

  if (process.platform === "win32") {
    await runProcess(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${escapePowerShellLiteral(input.archivePath)}' -DestinationPath '${escapePowerShellLiteral(input.destinationDir)}' -Force`,
      ],
      { timeoutMs: 120_000 },
    );
    return;
  }

  await runProcess("unzip", ["-o", input.archivePath, "-d", input.destinationDir], {
    timeoutMs: 120_000,
  });
}

export async function ensureRuntimeBinaryPermissions(binaryPath: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  await fs.chmod(binaryPath, 0o755);
}

export async function buildMetalRuntimeFromSource(input: {
  sourceDir: string;
  outputDir: string;
}): Promise<void> {
  const directCmakePath = path.join(input.sourceDir, "CMakeLists.txt");
  const directExists = (await fs.stat(directCmakePath).catch(() => null))?.isFile() ?? false;
  let sourceDir = input.sourceDir;
  if (!directExists) {
    const entries = await fs.readdir(input.sourceDir, { withFileTypes: true }).catch(() => []);
    const nested = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const candidate = path.join(input.sourceDir, entry.name, "CMakeLists.txt");
          return ((await fs.stat(candidate).catch(() => null))?.isFile() ?? false)
            ? path.join(input.sourceDir, entry.name)
            : null;
        }),
    );
    const resolved = nested.find(Boolean);
    if (resolved) {
      sourceDir = resolved;
    }
  }

  const buildDir = path.join(sourceDir, "build-metal");
  await fs.rm(buildDir, { recursive: true, force: true });
  await fs.mkdir(buildDir, { recursive: true });
  await runProcess(
    "cmake",
    ["-S", sourceDir, "-B", buildDir, "-DWHISPER_BUILD_SERVER=ON", "-DCMAKE_BUILD_TYPE=Release"],
    { timeoutMs: 10 * 60_000 },
  );
  await runProcess(
    "cmake",
    ["--build", buildDir, "--config", "Release", "--target", "whisper-cli", "whisper-server"],
    { timeoutMs: 30 * 60_000 },
  );

  await fs.rm(input.outputDir, { recursive: true, force: true });
  await fs.mkdir(input.outputDir, { recursive: true });

  const releaseBinDir = path.join(buildDir, "bin");
  const releaseDir = path.join(buildDir, "Release");
  for (const candidate of [releaseBinDir, releaseDir, buildDir]) {
    const cliPath = path.join(candidate, "whisper-cli");
    const serverPath = path.join(candidate, "whisper-server");
    const cliExists = (await fs.stat(cliPath).catch(() => null))?.isFile() ?? false;
    const serverExists = (await fs.stat(serverPath).catch(() => null))?.isFile() ?? false;
    if (cliExists && serverExists) {
      await fs.copyFile(cliPath, path.join(input.outputDir, "whisper-cli"));
      await fs.copyFile(serverPath, path.join(input.outputDir, "whisper-server"));
      await ensureRuntimeBinaryPermissions(path.join(input.outputDir, "whisper-cli"));
      await ensureRuntimeBinaryPermissions(path.join(input.outputDir, "whisper-server"));
      return;
    }
  }

  throw new Error(
    "Built whisper.cpp source but could not locate whisper-cli and whisper-server binaries.",
  );
}
