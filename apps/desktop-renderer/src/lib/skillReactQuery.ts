import type { SkillCatalogListResult } from "@samscode/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const skillQueryKeys = {
  all: ["skills"] as const,
  catalog: ["skills", "catalog"] as const,
};

const EMPTY_SKILL_CATALOG_RESULT: SkillCatalogListResult = {
  writableCatalogPath: "pending",
  entries: [],
};

export function skillCatalogQueryOptions() {
  return queryOptions({
    queryKey: skillQueryKeys.catalog,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.skills.listCatalog({});
    },
    staleTime: 5_000,
    placeholderData: (previous) => previous ?? EMPTY_SKILL_CATALOG_RESULT,
  });
}
