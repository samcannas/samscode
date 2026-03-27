import type { DesktopBridge } from "@samscode/contracts";

export interface ProjectFolderPickerRuntime {
  desktopBridge?: Pick<DesktopBridge, "pickFolder">;
}

export function hasDesktopProjectFolderPicker(
  runtime: ProjectFolderPickerRuntime | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return typeof runtime?.desktopBridge?.pickFolder === "function";
}

export function hasNativeProjectFolderPicker(
  runtime: ProjectFolderPickerRuntime | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return hasDesktopProjectFolderPicker(runtime);
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
