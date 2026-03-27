import type { UpstreamSyncReleaseReport, UpstreamSyncStatus } from "@samscode/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const upstreamSyncQueryKeys = {
  all: ["upstream-sync"] as const,
  status: (cwd: string | null) => ["upstream-sync", "status", cwd] as const,
  release: (cwd: string | null, tag: string | null) =>
    ["upstream-sync", "release", cwd, tag] as const,
};

const EMPTY_STATUS_PLACEHOLDER: UpstreamSyncStatus | undefined = undefined;
const EMPTY_RELEASE_PLACEHOLDER: UpstreamSyncReleaseReport | undefined = undefined;

export function upstreamSyncStatusQueryOptions(input: { cwd: string | null; enabled?: boolean }) {
  return queryOptions({
    queryKey: upstreamSyncQueryKeys.status(input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Upstream sync is unavailable because no workspace root is active.");
      }
      return api.upstreamSync.getStatus({ cwd: input.cwd });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? EMPTY_STATUS_PLACEHOLDER,
  });
}

export function upstreamSyncReleaseQueryOptions(input: {
  cwd: string | null;
  tag: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: upstreamSyncQueryKeys.release(input.cwd, input.tag),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.tag) {
        throw new Error("Upstream release details are unavailable.");
      }
      return api.upstreamSync.getRelease({ cwd: input.cwd, tag: input.tag });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.tag !== null,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? EMPTY_RELEASE_PLACEHOLDER,
  });
}
