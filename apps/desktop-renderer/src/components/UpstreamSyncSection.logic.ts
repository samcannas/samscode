import type { UpstreamSyncReviewPhase, UpstreamSyncReviewState } from "@samscode/contracts";

export function isUpstreamReviewBusy(input: {
  isStartingReview: boolean;
  reviewStatus: UpstreamSyncReviewState["status"] | null | undefined;
}): boolean {
  return input.isStartingReview || input.reviewStatus === "running";
}

export function getUpstreamReviewButtonLabel(input: {
  isStartingReview: boolean;
  reviewStatus: UpstreamSyncReviewState["status"] | null | undefined;
}): string {
  if (input.isStartingReview) {
    return "Starting review...";
  }
  if (input.reviewStatus === "running") {
    return "Reviewing...";
  }
  return "Review next release";
}

export function shouldShowUpstreamReviewStartupCard(input: {
  isStartingReview: boolean;
  reviewStatus: UpstreamSyncReviewState["status"] | null | undefined;
  reviewPhase: UpstreamSyncReviewPhase | null | undefined;
}): boolean {
  return (
    input.isStartingReview ||
    (input.reviewStatus === "running" && input.reviewPhase === "fetching-upstream")
  );
}
