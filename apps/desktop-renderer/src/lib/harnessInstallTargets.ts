import type { ProviderKind } from "@samscode/contracts";

export type HarnessInstallTarget = "all" | ProviderKind;

export const HARNESS_TARGET_LABELS: Record<HarnessInstallTarget, string> = {
  all: "Both harnesses",
  codex: "Codex",
  claudeAgent: "Claude Code",
};

export function supportedTargetsForProviders(
  supports: readonly ProviderKind[],
): HarnessInstallTarget[] {
  const supportsCodex = supports.includes("codex");
  const supportsClaude = supports.includes("claudeAgent");
  if (supportsCodex && supportsClaude) {
    return ["all", "codex", "claudeAgent"];
  }
  if (supportsCodex) {
    return ["codex"];
  }
  return ["claudeAgent"];
}

export function installStateSummary(installState: {
  codex: boolean;
  claudeAgent: boolean;
}): string {
  if (installState.codex && installState.claudeAgent) {
    return "Installed everywhere";
  }
  if (installState.codex) {
    return "Installed for Codex";
  }
  if (installState.claudeAgent) {
    return "Installed for Claude Code";
  }
  return "Not installed";
}

export function isTargetInstalled(
  installState: { codex: boolean; claudeAgent: boolean },
  target: HarnessInstallTarget,
): boolean {
  if (target === "all") {
    return installState.codex && installState.claudeAgent;
  }
  return installState[target];
}

export function affectedProvidersForTarget(target: HarnessInstallTarget): ProviderKind[] {
  if (target === "all") {
    return ["codex", "claudeAgent"];
  }
  return [target];
}
