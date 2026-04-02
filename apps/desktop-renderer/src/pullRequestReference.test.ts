import { describe, expect, it } from "vitest";

import { parsePullRequestReference } from "./pullRequestReference";

describe("parsePullRequestReference", () => {
  it("accepts GitHub pull request URLs", () => {
    expect(parsePullRequestReference("https://github.com/samcannas/samscode/pull/42")).toBe(
      "https://github.com/samcannas/samscode/pull/42",
    );
  });

  it("accepts raw numbers", () => {
    expect(parsePullRequestReference("42")).toBe("42");
  });

  it("accepts #number references", () => {
    expect(parsePullRequestReference("#42")).toBe("#42");
  });

  it("accepts gh pr checkout number references", () => {
    expect(parsePullRequestReference("gh pr checkout 42")).toBe("42");
  });

  it("accepts gh pr checkout url references", () => {
    expect(
      parsePullRequestReference("gh pr checkout https://github.com/samcannas/samscode/pull/42"),
    ).toBe("https://github.com/samcannas/samscode/pull/42");
  });

  it("rejects non-pull-request input", () => {
    expect(parsePullRequestReference("feature/my-branch")).toBeNull();
  });
});
