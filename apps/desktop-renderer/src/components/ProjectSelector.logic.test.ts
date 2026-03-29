import { describe, expect, it } from "vitest";

import { getAdjacentProjectIdInCycle } from "./ProjectSelector.logic";

const projects = [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }] as const;

describe("getAdjacentProjectIdInCycle", () => {
  it("returns null when there are no projects", () => {
    expect(getAdjacentProjectIdInCycle([], null, 1)).toBeNull();
  });

  it("moves forward through the list and wraps to the start", () => {
    expect(getAdjacentProjectIdInCycle(projects, "alpha", 1)).toBe("beta");
    expect(getAdjacentProjectIdInCycle(projects, "gamma", 1)).toBe("alpha");
  });

  it("moves backward through the list and wraps to the end", () => {
    expect(getAdjacentProjectIdInCycle(projects, "gamma", -1)).toBe("beta");
    expect(getAdjacentProjectIdInCycle(projects, "alpha", -1)).toBe("gamma");
  });

  it("falls back to the first or last project when the active id is missing", () => {
    expect(getAdjacentProjectIdInCycle(projects, null, 1)).toBe("alpha");
    expect(getAdjacentProjectIdInCycle(projects, "missing", -1)).toBe("gamma");
  });
});
