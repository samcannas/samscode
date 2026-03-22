import type { DesktopBridge } from "@samscode/contracts";

interface BrowserDirectoryPickerHandle {
  kind?: "directory";
  name?: string;
}

export interface ProjectFolderPickerRuntime {
  desktopBridge?: Pick<DesktopBridge, "pickFolder">;
  isSecureContext?: boolean;
  showDirectoryPicker?: () => Promise<BrowserDirectoryPickerHandle>;
}

export function hasDesktopProjectFolderPicker(
  runtime: ProjectFolderPickerRuntime | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return typeof runtime?.desktopBridge?.pickFolder === "function";
}

export function supportsBrowserDirectoryPicker(
  runtime: ProjectFolderPickerRuntime | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return runtime?.isSecureContext === true && typeof runtime.showDirectoryPicker === "function";
}

export function canResolveBrowserDirectoryPickerToProjectPath(): boolean {
  // Sam's Code project creation ultimately needs a real workspace path string.
  // The browser File System Access API exposes directory handles, not a stable
  // local absolute path, so the web app must fail closed to manual path entry.
  return false;
}

export function hasNativeProjectFolderPicker(
  runtime: ProjectFolderPickerRuntime | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return (
    hasDesktopProjectFolderPicker(runtime) ||
    (supportsBrowserDirectoryPicker(runtime) && canResolveBrowserDirectoryPickerToProjectPath())
  );
}

export async function pickProjectFolder(
  runtime: ProjectFolderPickerRuntime | undefined = typeof window === "undefined"
    ? undefined
    : window,
): Promise<string | null> {
  if (hasDesktopProjectFolderPicker(runtime)) {
    return runtime?.desktopBridge?.pickFolder() ?? null;
  }

  return null;
}
