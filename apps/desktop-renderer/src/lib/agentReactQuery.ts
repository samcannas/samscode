import type { AgentCatalogListResult } from "@samscode/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const agentQueryKeys = {
  all: ["agents"] as const,
  catalog: (codexHomePath: string | null) => ["agents", "catalog", codexHomePath] as const,
};

const EMPTY_AGENT_CATALOG_RESULT: AgentCatalogListResult = {
  writableCatalogPath: "pending",
  entries: [],
};

export function agentCatalogQueryOptions(input: { codexHomePath: string | null }) {
  return queryOptions({
    queryKey: agentQueryKeys.catalog(input.codexHomePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.agents.listCatalog(
        input.codexHomePath ? { codexHomePath: input.codexHomePath } : {},
      );
    },
    staleTime: 5_000,
    placeholderData: (previous) => previous ?? EMPTY_AGENT_CATALOG_RESULT,
  });
}
