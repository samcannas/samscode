import type { AgentCatalogEntry, AgentInstallTarget, ThreadId } from "@samscode/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAppSettings } from "~/appSettings";
import { CatalogCard } from "~/components/CatalogCard";
import { CatalogPageLayout } from "~/components/CatalogPageLayout";
import { toastManager } from "~/components/ui/toast";
import {
  affectedProvidersForTarget,
  HARNESS_TARGET_LABELS,
  isTargetInstalled,
  supportedTargetsForProviders,
} from "~/lib/harnessInstallTargets";
import { agentCatalogQueryOptions, agentQueryKeys } from "~/lib/agentReactQuery";
import { newCommandId } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

function normalizeCodexHomePath(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function maybeRestartAffectedSessions(input: {
  target: AgentInstallTarget;
  result: {
    activeSessionThreadIdsByProvider: {
      codex: readonly ThreadId[];
      claudeAgent: readonly ThreadId[];
    };
  };
  actionLabel: string;
}) {
  const api = ensureNativeApi();
  const threadIds = Array.from(
    new Set<ThreadId>(
      affectedProvidersForTarget(input.target).flatMap(
        (provider) => input.result.activeSessionThreadIdsByProvider[provider],
      ),
    ),
  );
  if (threadIds.length === 0) {
    return;
  }
  const confirmed = await api.dialogs.confirm(
    [
      `${input.actionLabel} updated one or more installed agents.`,
      "",
      `${threadIds.length} active provider session${threadIds.length === 1 ? "" : "s"} should be restarted before the change takes effect.`,
      "",
      "Restart those sessions now?",
    ].join("\n"),
  );
  if (!confirmed) {
    toastManager.add({
      type: "info",
      title: "Agent change saved",
      description:
        "Restart the affected Codex or Claude sessions later to pick up the new agent configuration.",
    });
    return;
  }

  await Promise.allSettled(
    threadIds.map((threadId) =>
      api.orchestration.dispatchCommand({
        type: "thread.session.stop",
        commandId: newCommandId(),
        threadId,
        createdAt: new Date().toISOString(),
      }),
    ),
  );
  toastManager.add({
    type: "success",
    title: "Sessions restarted",
    description:
      "The affected provider sessions were stopped and will reload the next time they are used.",
  });
}

function buildAgentMetaText(entry: AgentCatalogEntry): string | undefined {
  const parts: string[] = [];
  if (entry.author) parts.push(`by ${entry.author}`);
  if (entry.vibe) parts.push(entry.vibe);
  if (entry.tools && entry.tools.length > 0) {
    const toolList = entry.tools.slice(0, 3).join(", ");
    const suffix = entry.tools.length > 3 ? ` +${entry.tools.length - 3}` : "";
    parts.push(`tools: ${toolList}${suffix}`);
  }
  return parts.length > 0 ? parts.join(" \u00b7 ") : undefined;
}

function AgentsRouteView() {
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const codexHomePath = normalizeCodexHomePath(settings.codexHomePath);
  const agentCatalogQuery = useQuery(agentCatalogQueryOptions({ codexHomePath }));
  const [searchValue, setSearchValue] = useState("");
  const [targetByAgentId, setTargetByAgentId] = useState<Record<string, AgentInstallTarget>>({});

  const installMutation = useMutation({
    mutationFn: async (input: { agentId: string; target: AgentInstallTarget }) => {
      const api = ensureNativeApi();
      return api.agents.install({
        agentId: input.agentId,
        target: input.target,
        ...(codexHomePath ? { codexHomePath } : {}),
      });
    },
    onSuccess: async (result, input) => {
      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.all });
      toastManager.add({
        type: "success",
        title: "Agent installed",
        description: `Installed for ${HARNESS_TARGET_LABELS[input.target].toLowerCase()}.`,
      });
      await maybeRestartAffectedSessions({
        target: input.target,
        result,
        actionLabel: "Installing agents",
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Install failed",
        description: error instanceof Error ? error.message : "Failed to install agent.",
      });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (input: { agentId: string; target: AgentInstallTarget }) => {
      const api = ensureNativeApi();
      return api.agents.uninstall({
        agentId: input.agentId,
        target: input.target,
        ...(codexHomePath ? { codexHomePath } : {}),
      });
    },
    onSuccess: async (result, input) => {
      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.all });
      toastManager.add({
        type: "success",
        title: "Agent removed",
        description: `Removed from ${HARNESS_TARGET_LABELS[input.target].toLowerCase()}.`,
      });
      await maybeRestartAffectedSessions({
        target: input.target,
        result,
        actionLabel: "Removing agents",
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Removal failed",
        description: error instanceof Error ? error.message : "Failed to remove agent.",
      });
    },
  });

  const filteredEntries = useMemo(() => {
    const entries = agentCatalogQuery.data?.entries ?? [];
    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return entries;
    }
    return entries.filter((entry) => {
      const haystack = [entry.name, entry.description, entry.id, entry.category, entry.subcategory]
        .filter((value): value is string => typeof value === "string")
        .join("\n")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [agentCatalogQuery.data?.entries, searchValue]);

  return (
    <CatalogPageLayout
      title="Agents"
      subtitle="Install agent definitions for Codex, Claude Code, or both."
      searchPlaceholder="Search agents"
      catalogPath={agentCatalogQuery.data?.writableCatalogPath}
      catalogHint="Drop markdown agent files into this folder and refresh."
      isLoading={agentCatalogQuery.isLoading}
      isEmpty={filteredEntries.length === 0}
      onRefresh={() => void queryClient.invalidateQueries({ queryKey: agentQueryKeys.all })}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      emptyTitle="No matching agents"
      emptyDescription="Add markdown agent files to the catalog folder or adjust your search."
    >
      {filteredEntries.map((entry) => {
        const supportedTargets = supportedTargetsForProviders(entry.supports);
        const selectedTarget = targetByAgentId[entry.id] ?? supportedTargets[0] ?? "all";
        const selectedTargetInstalled = isTargetInstalled(entry.installState, selectedTarget);
        const isBusy =
          installMutation.isPending && installMutation.variables?.agentId === entry.id
            ? true
            : uninstallMutation.isPending && uninstallMutation.variables?.agentId === entry.id;

        return (
          <CatalogCard
            key={entry.id}
            entry={entry}
            selectedTarget={selectedTarget}
            selectedTargetInstalled={selectedTargetInstalled}
            supportedTargets={supportedTargets}
            isBusy={isBusy}
            metaText={buildAgentMetaText(entry)}
            onTargetChange={(target) => {
              setTargetByAgentId((existing) => ({
                ...existing,
                [entry.id]: target,
              }));
            }}
            onInstall={() => installMutation.mutate({ agentId: entry.id, target: selectedTarget })}
            onUninstall={() =>
              uninstallMutation.mutate({ agentId: entry.id, target: selectedTarget })
            }
          />
        );
      })}
    </CatalogPageLayout>
  );
}

export const Route = createFileRoute("/_chat/agents")({
  component: AgentsRouteView,
});
