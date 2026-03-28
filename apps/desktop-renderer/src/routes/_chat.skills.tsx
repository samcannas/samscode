import type { SkillCatalogEntry, SkillInstallTarget } from "@samscode/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CatalogCard } from "~/components/CatalogCard";
import { CatalogPageLayout } from "~/components/CatalogPageLayout";
import { toastManager } from "~/components/ui/toast";
import {
  HARNESS_TARGET_LABELS,
  isTargetInstalled,
  supportedTargetsForProviders,
} from "~/lib/harnessInstallTargets";
import { skillCatalogQueryOptions, skillQueryKeys } from "~/lib/skillReactQuery";
import { ensureNativeApi } from "~/nativeApi";

function buildSkillMetaText(entry: SkillCatalogEntry): string | undefined {
  const parts: string[] = [];
  if (entry.model) parts.push(`model: ${entry.model}`);
  if (entry.effort) parts.push(`effort: ${entry.effort}`);
  if (entry.context) parts.push(`context: ${entry.context}`);
  if (entry.license) parts.push(entry.license);
  return parts.length > 0 ? parts.join(" \u00b7 ") : undefined;
}

function buildSkillDetailsTooltip(entry: SkillCatalogEntry): React.ReactNode | undefined {
  const lines: string[] = [];
  lines.push(
    `${entry.supportingFileCount} supporting file${entry.supportingFileCount === 1 ? "" : "s"}`,
  );
  if (entry.hasScripts) lines.push("Has scripts");
  if (!entry.implicitInvocationEnabled) lines.push("Manual invocation only");
  if (!entry.userInvocable) lines.push("Hidden from user");
  if (entry.argumentHint) lines.push(`Args: ${entry.argumentHint}`);

  // Always show at least the file count
  return (
    <span>
      {lines.map((line, i) => (
        <span key={line}>
          {line}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </span>
  );
}

function SkillsRouteView() {
  const queryClient = useQueryClient();
  const skillCatalogQuery = useQuery(skillCatalogQueryOptions());
  const [searchValue, setSearchValue] = useState("");
  const [targetBySkillId, setTargetBySkillId] = useState<Record<string, SkillInstallTarget>>({});

  const installMutation = useMutation({
    mutationFn: async (input: { skillId: string; target: SkillInstallTarget }) => {
      const api = ensureNativeApi();
      return api.skills.install({
        skillId: input.skillId,
        target: input.target,
      });
    },
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });
      toastManager.add({
        type: "success",
        title: "Skill installed",
        description: `Installed for ${HARNESS_TARGET_LABELS[input.target].toLowerCase()}.`,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Install failed",
        description: error instanceof Error ? error.message : "Failed to install skill.",
      });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (input: { skillId: string; target: SkillInstallTarget }) => {
      const api = ensureNativeApi();
      return api.skills.uninstall({
        skillId: input.skillId,
        target: input.target,
      });
    },
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });
      toastManager.add({
        type: "success",
        title: "Skill removed",
        description: `Removed from ${HARNESS_TARGET_LABELS[input.target].toLowerCase()}.`,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Removal failed",
        description: error instanceof Error ? error.message : "Failed to remove skill.",
      });
    },
  });

  const filteredEntries = useMemo(() => {
    const entries = skillCatalogQuery.data?.entries ?? [];
    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return entries;
    }
    return entries.filter((entry) => {
      const haystack = [
        entry.name,
        entry.description,
        entry.id,
        entry.category,
        entry.subcategory,
        entry.argumentHint,
        entry.context,
        entry.model,
      ]
        .filter((value): value is string => typeof value === "string")
        .join("\n")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [searchValue, skillCatalogQuery.data?.entries]);

  return (
    <CatalogPageLayout
      title="Skills"
      subtitle="Install reusable skill bundles for Codex, Claude Code, or both."
      searchPlaceholder="Search skills"
      catalogPath={skillCatalogQuery.data?.writableCatalogPath}
      catalogHint="Drop full skill folders into this directory and refresh."
      isLoading={skillCatalogQuery.isLoading}
      isEmpty={filteredEntries.length === 0}
      onRefresh={() => void queryClient.invalidateQueries({ queryKey: skillQueryKeys.all })}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      emptyTitle="No matching skills"
      emptyDescription="Add skill folders to the catalog directory or adjust your search."
    >
      {filteredEntries.map((entry) => {
        const supportedTargets = supportedTargetsForProviders(entry.supports);
        const selectedTarget = targetBySkillId[entry.id] ?? supportedTargets[0] ?? "all";
        const selectedTargetInstalled = isTargetInstalled(entry.installState, selectedTarget);
        const isBusy =
          installMutation.isPending && installMutation.variables?.skillId === entry.id
            ? true
            : uninstallMutation.isPending && uninstallMutation.variables?.skillId === entry.id;

        return (
          <CatalogCard
            key={entry.id}
            entry={entry}
            selectedTarget={selectedTarget}
            selectedTargetInstalled={selectedTargetInstalled}
            supportedTargets={supportedTargets}
            isBusy={isBusy}
            metaText={buildSkillMetaText(entry)}
            detailsTooltip={buildSkillDetailsTooltip(entry)}
            onTargetChange={(target) => {
              setTargetBySkillId((existing) => ({
                ...existing,
                [entry.id]: target,
              }));
            }}
            onInstall={() => installMutation.mutate({ skillId: entry.id, target: selectedTarget })}
            onUninstall={() =>
              uninstallMutation.mutate({ skillId: entry.id, target: selectedTarget })
            }
          />
        );
      })}
    </CatalogPageLayout>
  );
}

export const Route = createFileRoute("/_chat/skills")({
  component: SkillsRouteView,
});
