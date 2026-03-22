function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const CODEX_IGNORED_GATED_REQUEST_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileRead/requestApproval",
  "item/fileChange/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
]);

export function isIgnoredCodexGatedRequestMethod(method: string): boolean {
  return CODEX_IGNORED_GATED_REQUEST_METHODS.has(method);
}

export function isIgnoredCodexGatedResolvedPayload(payload: unknown): boolean {
  const record = asObject(payload);
  const request = asObject(record?.request);
  const method = asString(request?.method) ?? asString(record?.method);
  if (method && isIgnoredCodexGatedRequestMethod(method)) {
    return true;
  }

  const requestKind = asString(request?.kind) ?? asString(record?.requestKind);
  return requestKind === "command" || requestKind === "file-read" || requestKind === "file-change";
}
