import { DependencyError } from "./errors.js";

export type SupportedPlatform = "darwin" | "win32";
export type SupportedArch = "x64" | "arm64";

export function getSupportedPlatform(): SupportedPlatform {
  if (process.platform === "darwin" || process.platform === "win32") {
    return process.platform;
  }
  throw new DependencyError(`Unsupported platform: ${process.platform}`);
}

export function getSupportedArch(): SupportedArch {
  if (process.arch === "x64" || process.arch === "arm64") {
    return process.arch;
  }
  throw new DependencyError(`Unsupported architecture: ${process.arch}`);
}

export function getPlatformKey(): `${SupportedPlatform}-${SupportedArch}` {
  return `${getSupportedPlatform()}-${getSupportedArch()}`;
}

export function isNodeDesktopRuntime(): boolean {
  return typeof process !== "undefined" && !!process.versions?.node;
}
