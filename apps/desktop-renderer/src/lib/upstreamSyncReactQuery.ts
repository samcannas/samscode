import type {
  UpstreamSyncReleaseReport,
  UpstreamSyncReviewState,
  UpstreamSyncStatus,
} from "@samscode/contracts";
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const upstreamSyncQueryKeys = {
  all: ["upstream-sync"] as const,
  status: (cwd: string | null) => ["upstream-sync", "status", cwd] as const,
  reviewState: (cwd: string | null) => ["upstream-sync", "review-state", cwd] as const,
  release: (cwd: string | null, tag: string | null) =>
    ["upstream-sync", "release", cwd, tag] as const,
};

const EMPTY_STATUS_PLACEHOLDER: UpstreamSyncStatus | undefined = undefined;
const EMPTY_REVIEW_STATE_PLACEHOLDER: UpstreamSyncReviewState | undefined = undefined;
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

export function upstreamSyncReviewStateQueryOptions(input: {
  cwd: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: upstreamSyncQueryKeys.reviewState(input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error(
          "Upstream review state is unavailable because no workspace root is active.",
        );
      }
      return api.upstreamSync.getReviewState({ cwd: input.cwd });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1_000 : false),
    placeholderData: (previous) => previous ?? EMPTY_REVIEW_STATE_PLACEHOLDER,
  });
}

export function subscribeToUpstreamSyncReviewState(params: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  const { cwd, queryClient } = params;
  if (!cwd) {
    return () => {};
  }
  const api = ensureNativeApi();
  return api.upstreamSync.onReviewStateChanged((state) => {
    if (state.cwd !== cwd) {
      return;
    }
    queryClient.setQueryData(upstreamSyncQueryKeys.reviewState(cwd), state);
    if (state.status === "completed" && state.releaseTag) {
      void queryClient.invalidateQueries({ queryKey: upstreamSyncQueryKeys.status(cwd) });
      void queryClient.invalidateQueries({
        queryKey: upstreamSyncQueryKeys.release(cwd, state.releaseTag),
      });
    }
  });
}
