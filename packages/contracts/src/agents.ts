import { Schema } from "effect";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const AgentCatalogId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
);
export type AgentCatalogId = typeof AgentCatalogId.Type;

export const AgentCatalogSource = Schema.Literals(["workspace", "user"]);
export type AgentCatalogSource = typeof AgentCatalogSource.Type;

export const AgentInstallTarget = Schema.Literals(["all", "codex", "claudeAgent"]);
export type AgentInstallTarget = typeof AgentInstallTarget.Type;

export const AgentInstallState = Schema.Struct({
  codex: Schema.Boolean,
  claudeAgent: Schema.Boolean,
});
export type AgentInstallState = typeof AgentInstallState.Type;

export const AgentCatalogEntry = Schema.Struct({
  id: AgentCatalogId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  description: TrimmedNonEmptyString.check(Schema.isMaxLength(1000)),
  category: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
  subcategory: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
  color: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  vibe: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(160))),
  author: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(160))),
  supports: Schema.Array(ProviderKind),
  tools: Schema.optional(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(120))).check(
      Schema.isMaxLength(64),
    ),
  ),
  installState: AgentInstallState,
  source: AgentCatalogSource,
  sourcePath: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
});
export type AgentCatalogEntry = typeof AgentCatalogEntry.Type;

export const AgentCatalogListInput = Schema.Struct({
  codexHomePath: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4096))),
});
export type AgentCatalogListInput = typeof AgentCatalogListInput.Type;

export const AgentCatalogListResult = Schema.Struct({
  writableCatalogPath: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  entries: Schema.Array(AgentCatalogEntry),
});
export type AgentCatalogListResult = typeof AgentCatalogListResult.Type;

export const AgentInstallInput = Schema.Struct({
  agentId: AgentCatalogId,
  target: AgentInstallTarget,
  codexHomePath: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4096))),
});
export type AgentInstallInput = typeof AgentInstallInput.Type;

export const AgentInstallResult = Schema.Struct({
  agentId: AgentCatalogId,
  installState: AgentInstallState,
  activeSessionThreadIdsByProvider: Schema.Struct({
    codex: Schema.Array(ThreadId),
    claudeAgent: Schema.Array(ThreadId),
  }),
});
export type AgentInstallResult = typeof AgentInstallResult.Type;

export const AgentUninstallInput = Schema.Struct({
  agentId: AgentCatalogId,
  target: AgentInstallTarget,
  codexHomePath: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4096))),
});
export type AgentUninstallInput = typeof AgentUninstallInput.Type;

export const AgentUninstallResult = AgentInstallResult;
export type AgentUninstallResult = typeof AgentUninstallResult.Type;
