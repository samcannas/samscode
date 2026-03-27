import {
  type AgentCatalogEntry,
  type AgentInstallTarget,
  type ThreadId,
} from "@samscode/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BotIcon, RefreshCcwIcon, WrenchIcon } from "lucide-react";
import { useAppSettings } from "~/appSettings";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SidebarInset } from "~/components/ui/sidebar";
import { toastManager } from "~/components/ui/toast";
import { isElectron } from "~/env";
import { agentCatalogQueryOptions, agentQueryKeys } from "~/lib/agentReactQuery";
import { newCommandId } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

const TARGET_LABELS: Record<AgentInstallTarget, string> = {
  all: "Both harnesses",
  codex: "Codex",
  claudeAgent: "Claude Code",
};

function normalizeCodexHomePath(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function supportedTargetsForEntry(entry: AgentCatalogEntry): AgentInstallTarget[] {
  const supportsCodex = entry.supports.includes("codex");
  const supportsClaude = entry.supports.includes("claudeAgent");
  if (supportsCodex && supportsClaude) {
    return ["all", "codex", "claudeAgent"];
  }
  if (supportsCodex) {
    return ["codex"];
  }
  return ["claudeAgent"];
}

function installedTargetSummary(entry: AgentCatalogEntry): string {
  if (entry.installState.codex && entry.installState.claudeAgent) {
    return "Installed everywhere";
  }
  if (entry.installState.codex) {
    return "Installed for Codex";
  }
  if (entry.installState.claudeAgent) {
    return "Installed for Claude Code";
  }
  return "Not installed";
}

function isTargetInstalled(entry: AgentCatalogEntry, target: AgentInstallTarget): boolean {
  if (target === "all") {
    return entry.installState.codex && entry.installState.claudeAgent;
  }
  return entry.installState[target];
}

function affectedProvidersForTarget(target: AgentInstallTarget): Array<"codex" | "claudeAgent"> {
  if (target === "all") {
    return ["codex", "claudeAgent"];
  }
  return [target];
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
        description: `Installed for ${TARGET_LABELS[input.target].toLowerCase()}.`,
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
        description: `Removed from ${TARGET_LABELS[input.target].toLowerCase()}.`,
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
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Agents
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agents</h1>
              <p className="text-sm text-muted-foreground">
                Install agent definitions for Codex, Claude Code, or both harnesses.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Catalog folder</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drop additional markdown agent files into this folder and they will appear here
                    on the next refresh.
                  </p>
                  <p className="mt-2 break-all rounded-lg border border-border/70 bg-background px-3 py-2 font-mono text-[11px] text-foreground/90">
                    {agentCatalogQuery.data?.writableCatalogPath ?? "Loading..."}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search agents"
                    className="w-full sm:w-64"
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      void queryClient.invalidateQueries({ queryKey: agentQueryKeys.all })
                    }
                  >
                    <RefreshCcwIcon className="size-4" />
                    Refresh
                  </Button>
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              {filteredEntries.map((entry) => {
                const supportedTargets = supportedTargetsForEntry(entry);
                const selectedTarget = targetByAgentId[entry.id] ?? supportedTargets[0] ?? "all";
                const selectedTargetInstalled = isTargetInstalled(entry, selectedTarget);
                const isBusy =
                  installMutation.isPending && installMutation.variables?.agentId === entry.id
                    ? true
                    : uninstallMutation.isPending &&
                      uninstallMutation.variables?.agentId === entry.id;
                return (
                  <article
                    key={entry.id}
                    className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-semibold text-foreground">{entry.name}</h2>
                          <Badge variant="outline">{entry.id}</Badge>
                          {entry.category ? (
                            <Badge variant="outline">{entry.category}</Badge>
                          ) : null}
                          <Badge variant="outline">{entry.source}</Badge>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {entry.description}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background p-2 text-muted-foreground/80">
                        <BotIcon className="size-5" />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant={entry.installState.codex ? "secondary" : "outline"}>
                        Codex {entry.installState.codex ? "installed" : "available"}
                      </Badge>
                      <Badge variant={entry.installState.claudeAgent ? "secondary" : "outline"}>
                        Claude Code {entry.installState.claudeAgent ? "installed" : "available"}
                      </Badge>
                      {entry.tools?.slice(0, 4).map((tool) => (
                        <Badge key={tool} variant="outline">
                          {tool}
                        </Badge>
                      ))}
                    </div>

                    <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                      {installedTargetSummary(entry)}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Select
                        value={selectedTarget}
                        onValueChange={(value) => {
                          if (value !== "all" && value !== "codex" && value !== "claudeAgent") {
                            return;
                          }
                          setTargetByAgentId((existing) => ({
                            ...existing,
                            [entry.id]: value,
                          }));
                        }}
                      >
                        <SelectTrigger
                          className="w-full sm:w-52"
                          aria-label={`Install target for ${entry.name}`}
                        >
                          <SelectValue>{TARGET_LABELS[selectedTarget]}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup align="start">
                          {supportedTargets.map((target) => (
                            <SelectItem key={target} value={target}>
                              {TARGET_LABELS[target]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          disabled={isBusy || !selectedTargetInstalled}
                          onClick={() =>
                            uninstallMutation.mutate({ agentId: entry.id, target: selectedTarget })
                          }
                        >
                          <WrenchIcon className="size-4" />
                          Remove
                        </Button>
                        <Button
                          disabled={isBusy}
                          onClick={() =>
                            installMutation.mutate({ agentId: entry.id, target: selectedTarget })
                          }
                        >
                          {selectedTargetInstalled ? "Reinstall" : "Install"}
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>

            {!agentCatalogQuery.isLoading && filteredEntries.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
                <p className="text-sm font-medium text-foreground">No matching agents</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add markdown agent files to the catalog folder or adjust your search.
                </p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/agents")({
  component: AgentsRouteView,
});
