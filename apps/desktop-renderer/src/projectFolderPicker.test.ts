import { describe, expect, it, vi } from "vitest";

import {
  hasDesktopProjectFolderPicker,
  hasNativeProjectFolderPicker,
  pickProjectFolder,
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

  it("returns null when no folder picker is usable", async () => {
    const runtime: ProjectFolderPickerRuntime = {};

    await expect(pickProjectFolder(runtime)).resolves.toBeNull();
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
