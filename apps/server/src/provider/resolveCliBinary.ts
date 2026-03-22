import fs from "node:fs";
import path from "node:path";

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function isNodeModulesBinDir(dirPath: string): boolean {
  const normalized = path.normalize(dirPath).toLowerCase();
  return normalized.endsWith(path.normalize("node_modules/.bin").toLowerCase());
}

function fileExists(candidatePath: string): boolean {
  try {
    const stat = fs.statSync(candidatePath);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === "win32") {
      return true;
    }
    fs.accessSync(candidatePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidateNames(command: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") {
    return [command];
  }

  const ext = path.extname(command);
  if (ext.length > 0) {
    return [command];
  }

  const pathExt = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = pathExt
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [command, ...extensions.map((entry) => `${command}${entry.toLowerCase()}`)];
}

export function resolveCliBinary(command: string, env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return command;
  }

  if (path.isAbsolute(trimmed) || trimmed.startsWith(".") || hasPathSeparator(trimmed)) {
    return trimmed;
  }

  const pathValue = env.PATH;
  if (!pathValue) {
    return trimmed;
  }

  const names = candidateNames(trimmed, env);
  let fallback: string | null = null;

  for (const dir of pathValue.split(path.delimiter)) {
    const trimmedDir = dir.trim();
    if (trimmedDir.length === 0) {
      continue;
    }

    for (const name of names) {
      const candidate = path.join(trimmedDir, name);
      if (!fileExists(candidate)) {
        continue;
      }
      if (!isNodeModulesBinDir(trimmedDir)) {
        return candidate;
      }
      fallback ??= candidate;
    }
  }

  return fallback ?? trimmed;
}
