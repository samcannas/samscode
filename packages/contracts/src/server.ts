import { Option, Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL, DEFAULT_GIT_TEXT_GENERATION_PROVIDER } from "./model";
import { ProviderKind } from "./orchestration";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderStatusState = Schema.Literals(["ready", "warning", "error"]);
export type ServerProviderStatusState = typeof ServerProviderStatusState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderStatus = Schema.Struct({
  provider: ProviderKind,
  status: ServerProviderStatusState,
  available: Schema.Boolean,
  authStatus: ServerProviderAuthStatus,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderStatus = typeof ServerProviderStatus.Type;

const ServerProviderStatuses = Schema.Array(ServerProviderStatus);

const withDefaults =
  <
    S extends Schema.Top & Schema.WithoutConstructorDefault,
    D extends S["~type.make.in"] & S["Encoded"],
  >(
    fallback: () => D,
  ) =>
  (schema: S) =>
    schema.pipe(
      Schema.withConstructorDefault(() => Option.some(fallback())),
      Schema.withDecodingDefault(() => fallback()),
    );

export const ServerRuntimeSettings = Schema.Struct({
  codexBinaryPath: Schema.NullOr(TrimmedNonEmptyString).pipe(withDefaults(() => null)),
  codexHomePath: Schema.NullOr(TrimmedNonEmptyString).pipe(withDefaults(() => null)),
  claudeBinaryPath: Schema.NullOr(TrimmedNonEmptyString).pipe(withDefaults(() => null)),
  textGenerationProvider: ProviderKind.pipe(
    withDefaults(() => DEFAULT_GIT_TEXT_GENERATION_PROVIDER),
  ),
  textGenerationModel: TrimmedNonEmptyString.pipe(
    withDefaults(() => DEFAULT_GIT_TEXT_GENERATION_MODEL),
  ),
});
export type ServerRuntimeSettings = typeof ServerRuntimeSettings.Type;

export const ServerUpdateSettingsInput = Schema.Struct({
  codexBinaryPath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  codexHomePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  claudeBinaryPath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  textGenerationProvider: Schema.optional(ProviderKind),
  textGenerationModel: Schema.optional(TrimmedNonEmptyString),
});
export type ServerUpdateSettingsInput = typeof ServerUpdateSettingsInput.Type;

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  settings: ServerRuntimeSettings,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
  availableEditors: Schema.Array(EditorId),
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerUpdateSettingsResult = Schema.Struct({
  settings: ServerRuntimeSettings,
});
export type ServerUpdateSettingsResult = typeof ServerUpdateSettingsResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  settings: ServerRuntimeSettings,
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;
