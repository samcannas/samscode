import { describe, expect, it, vi } from "vitest";

import {
  canResolveBrowserDirectoryPickerToProjectPath,
  hasDesktopProjectFolderPicker,
  hasNativeProjectFolderPicker,
  pickProjectFolder,
  supportsBrowserDirectoryPicker,
  type ProjectFolderPickerRuntime,
} from "./projectFolderPicker";

describe("projectFolderPicker", () => {
  it("detects the desktop bridge picker when available", () => {
    const runtime: ProjectFolderPickerRuntime = {
      desktopBridge: {
        pickFolder: vi.fn(),
      },
    };

    expect(hasDesktopProjectFolderPicker(runtime)).toBe(true);
    expect(hasNativeProjectFolderPicker(runtime)).toBe(true);
  });

  it("detects browser directory picker support in secure contexts", () => {
    const runtime: ProjectFolderPickerRuntime = {
      isSecureContext: true,
      showDirectoryPicker: vi.fn(),
    };

    expect(supportsBrowserDirectoryPicker(runtime)).toBe(true);
  });

  it("fails closed for browser picker support because no project path can be resolved", () => {
    const runtime: ProjectFolderPickerRuntime = {
      isSecureContext: true,
      showDirectoryPicker: vi.fn(),
    };

    expect(canResolveBrowserDirectoryPickerToProjectPath()).toBe(false);
    expect(hasNativeProjectFolderPicker(runtime)).toBe(false);
  });

  it("returns null when no folder picker is usable", async () => {
    const runtime: ProjectFolderPickerRuntime = {
      isSecureContext: true,
      showDirectoryPicker: vi.fn(),
    };

    await expect(pickProjectFolder(runtime)).resolves.toBeNull();
    expect(runtime.showDirectoryPicker).not.toHaveBeenCalled();
  });

  it("delegates to the desktop bridge picker when available", async () => {
    const pickFolder = vi.fn<() => Promise<string | null>>().mockResolvedValue("/tmp/project");
    const runtime: ProjectFolderPickerRuntime = {
      desktopBridge: { pickFolder },
    };

    await expect(pickProjectFolder(runtime)).resolves.toBe("/tmp/project");
    expect(pickFolder).toHaveBeenCalledTimes(1);
  });

  it("returns null when the desktop picker is canceled", async () => {
    const pickFolder = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
    const runtime: ProjectFolderPickerRuntime = {
      desktopBridge: { pickFolder },
    };

    await expect(pickProjectFolder(runtime)).resolves.toBeNull();
  });
});
