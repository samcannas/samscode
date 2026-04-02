import { describe, expect, it } from "vitest";

import {
  getUpstreamReviewButtonLabel,
  isUpstreamReviewBusy,
  shouldShowUpstreamReviewStartupCard,
} from "./UpstreamSyncSection.logic";

describe("UpstreamSyncSection logic", () => {
  it("shows a starting label and busy state before the RPC resolves", () => {
    expect(
      getUpstreamReviewButtonLabel({
        isStartingReview: true,
        reviewStatus: "idle",
      }),
    ).toBe("Starting review...");
    expect(
      isUpstreamReviewBusy({
        isStartingReview: true,
        reviewStatus: "idle",
      }),
    ).toBe(true);
  });

  it("shows a reviewing label while the server reports a running review", () => {
    expect(
      getUpstreamReviewButtonLabel({
        isStartingReview: false,
        reviewStatus: "running",
      }),
    ).toBe("Reviewing...");
    expect(
      isUpstreamReviewBusy({
        isStartingReview: false,
        reviewStatus: "running",
      }),
    ).toBe(true);
  });

  it("shows the startup card while starting or fetching upstream", () => {
    expect(
      shouldShowUpstreamReviewStartupCard({
        isStartingReview: true,
        reviewStatus: "idle",
        reviewPhase: "idle",
      }),
    ).toBe(true);
    expect(
      shouldShowUpstreamReviewStartupCard({
        isStartingReview: false,
        reviewStatus: "running",
        reviewPhase: "fetching-upstream",
      }),
    ).toBe(true);
    expect(
      shouldShowUpstreamReviewStartupCard({
        isStartingReview: false,
        reviewStatus: "running",
        reviewPhase: "analyzing",
      }),
    ).toBe(false);
  });
});
