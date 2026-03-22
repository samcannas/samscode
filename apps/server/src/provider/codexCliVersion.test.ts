import { describe, expect, it } from "vitest";

import {
  compareCodexCliVersions,
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "./codexCliVersion";

describe("parseCodexCliVersion", () => {
  it("parses a plain codex-cli version line", () => {
    expect(parseCodexCliVersion("codex-cli 0.116.0\n")).toBe("0.116.0");
  });

  it("prefers codex-labeled lines over unrelated versions", () => {
    const output = [
      "warning: helper package 0.2.3 is deprecated",
      "codex-cli 0.116.0",
      "node v22.14.0",
    ].join("\n");

    expect(parseCodexCliVersion(output)).toBe("0.116.0");
  });

  it("falls back to the highest parseable version when no codex label exists", () => {
    expect(parseCodexCliVersion("0.2.3\n0.116.0\n")).toBe("0.116.0");
  });
});

describe("compareCodexCliVersions", () => {
  it("compares normalized semver values", () => {
    expect(compareCodexCliVersions("0.116.0", "0.37.0")).toBeGreaterThan(0);
    expect(compareCodexCliVersions("0.37", "0.37.0")).toBe(0);
  });
});

describe("isCodexCliVersionSupported", () => {
  it("accepts supported versions", () => {
    expect(isCodexCliVersionSupported("0.116.0")).toBe(true);
    expect(isCodexCliVersionSupported("0.36.0")).toBe(false);
  });
});

describe("formatCodexCliUpgradeMessage", () => {
  it("formats a user-facing upgrade message", () => {
    expect(formatCodexCliUpgradeMessage("0.36.0")).toContain("v0.37.0 or newer");
  });
});
