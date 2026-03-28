import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const SkillCatalogId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
);
export type SkillCatalogId = typeof SkillCatalogId.Type;

export const SkillCatalogSource = Schema.Literals(["workspace", "user"]);
export type SkillCatalogSource = typeof SkillCatalogSource.Type;

export const SkillInstallTarget = Schema.Literals(["all", "codex", "claudeAgent"]);
export type SkillInstallTarget = typeof SkillInstallTarget.Type;

export const SkillInstallState = Schema.Struct({
  codex: Schema.Boolean,
  claudeAgent: Schema.Boolean,
});
export type SkillInstallState = typeof SkillInstallState.Type;

export const SkillCatalogEntry = Schema.Struct({
  id: SkillCatalogId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  description: TrimmedNonEmptyString.check(Schema.isMaxLength(1000)),
  category: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
  subcategory: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
  supports: Schema.Array(ProviderKind),
  installState: SkillInstallState,
  source: SkillCatalogSource,
  sourcePath: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  entrypointPath: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  supportingFileCount: NonNegativeInt,
  hasScripts: Schema.Boolean,
  userInvocable: Schema.Boolean,
  implicitInvocationEnabled: Schema.Boolean,
  argumentHint: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(160))),
  license: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(240))),
  model: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(160))),
  effort: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(32))),
  context: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(32))),
});
export type SkillCatalogEntry = typeof SkillCatalogEntry.Type;

export const SkillCatalogListInput = Schema.Struct({});
export type SkillCatalogListInput = typeof SkillCatalogListInput.Type;

export const SkillCatalogListResult = Schema.Struct({
  writableCatalogPath: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  entries: Schema.Array(SkillCatalogEntry),
});
export type SkillCatalogListResult = typeof SkillCatalogListResult.Type;

export const SkillInstallInput = Schema.Struct({
  skillId: SkillCatalogId,
  target: SkillInstallTarget,
});
export type SkillInstallInput = typeof SkillInstallInput.Type;

export const SkillInstallResult = Schema.Struct({
  skillId: SkillCatalogId,
  installState: SkillInstallState,
});
export type SkillInstallResult = typeof SkillInstallResult.Type;

export const SkillUninstallInput = Schema.Struct({
  skillId: SkillCatalogId,
  target: SkillInstallTarget,
});
export type SkillUninstallInput = typeof SkillUninstallInput.Type;

export const SkillUninstallResult = SkillInstallResult;
export type SkillUninstallResult = typeof SkillUninstallResult.Type;

export const SkillPromptBuildInput = Schema.Struct({
  provider: ProviderKind,
  prompt: Schema.String,
  skillIds: Schema.Array(SkillCatalogId).check(Schema.isMaxLength(32)),
});
export type SkillPromptBuildInput = typeof SkillPromptBuildInput.Type;

export const SkillPromptBuildResult = Schema.Struct({
  prompt: Schema.String,
});
export type SkillPromptBuildResult = typeof SkillPromptBuildResult.Type;
