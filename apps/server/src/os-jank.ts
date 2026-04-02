import * as OS from "node:os";
import { Effect, Path } from "effect";
import { readPathFromLoginShell } from "@samscode/shared/shell";

export function fixPath(): void {
  if (process.platform !== "darwin" && process.platform !== "linux") return;

  try {
    const shell = process.env.SHELL ?? (process.platform === "linux" ? "/bin/bash" : "/bin/zsh");
    const result = readPathFromLoginShell(shell);
    if (result) {
      process.env.PATH = result;
    }
  } catch {
    // Silently ignore — keep default PATH
  }
}

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(OS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return join(OS.homedir(), ".samscode");
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
