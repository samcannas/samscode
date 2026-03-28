import { type SkillCatalogEntry, type SkillInstallTarget } from "@samscode/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BookCopyIcon, RefreshCcwIcon } from "lucide-react";
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
import {
  HARNESS_TARGET_LABELS,
  installStateSummary,
  isTargetInstalled,
  supportedTargetsForProviders,
} from "~/lib/harnessInstallTargets";
import { skillCatalogQueryOptions, skillQueryKeys } from "~/lib/skillReactQuery";
import { ensureNativeApi } from "~/nativeApi";

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
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground/70">Skills</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Skills</h1>
              <p className="text-sm text-muted-foreground">
                Install reusable skill bundles for Codex, Claude Code, or both harnesses.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Catalog folder</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drop full skill folders into this directory and they will appear here on the
                    next refresh.
                  </p>
                  <p className="mt-2 break-all rounded-lg border border-border/70 bg-background px-3 py-2 font-mono text-[11px] text-foreground/90">
                    {skillCatalogQuery.data?.writableCatalogPath ?? "Loading..."}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search skills"
                    className="w-full sm:w-64"
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      void queryClient.invalidateQueries({ queryKey: skillQueryKeys.all })
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
                const supportedTargets = supportedTargetsForProviders(entry.supports);
                const selectedTarget = targetBySkillId[entry.id] ?? supportedTargets[0] ?? "all";
                const selectedTargetInstalled = isTargetInstalled(
                  entry.installState,
                  selectedTarget,
                );
                const isBusy =
                  installMutation.isPending && installMutation.variables?.skillId === entry.id
                    ? true
                    : uninstallMutation.isPending &&
                      uninstallMutation.variables?.skillId === entry.id;

                return (
                  <SkillCard
                    key={entry.id}
                    entry={entry}
                    selectedTarget={selectedTarget}
                    selectedTargetInstalled={selectedTargetInstalled}
                    supportedTargets={supportedTargets}
                    isBusy={isBusy}
                    onTargetChange={(target) => {
                      setTargetBySkillId((existing) => ({
                        ...existing,
                        [entry.id]: target,
                      }));
                    }}
                    onInstall={() =>
                      installMutation.mutate({ skillId: entry.id, target: selectedTarget })
                    }
                    onUninstall={() =>
                      uninstallMutation.mutate({ skillId: entry.id, target: selectedTarget })
                    }
                  />
                );
              })}
            </section>

            {!skillCatalogQuery.isLoading && filteredEntries.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
                <p className="text-sm font-medium text-foreground">No matching skills</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add skill folders to the catalog directory or adjust your search.
                </p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function SkillCard(props: {
  entry: SkillCatalogEntry;
  selectedTarget: SkillInstallTarget;
  selectedTargetInstalled: boolean;
  supportedTargets: readonly SkillInstallTarget[];
  isBusy: boolean;
  onTargetChange: (target: SkillInstallTarget) => void;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{props.entry.name}</h2>
            <Badge variant="outline">/{props.entry.id}</Badge>
            {props.entry.category ? <Badge variant="outline">{props.entry.category}</Badge> : null}
            <Badge variant="outline">{props.entry.source}</Badge>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {props.entry.description}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-background p-2 text-muted-foreground/80">
          <BookCopyIcon className="size-5" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant={props.entry.installState.codex ? "secondary" : "outline"}>
          Codex {props.entry.installState.codex ? "installed" : "available"}
        </Badge>
        <Badge variant={props.entry.installState.claudeAgent ? "secondary" : "outline"}>
          Claude Code {props.entry.installState.claudeAgent ? "installed" : "available"}
        </Badge>
        <Badge variant="outline">{props.entry.supportingFileCount} files</Badge>
        {props.entry.hasScripts ? <Badge variant="outline">scripts</Badge> : null}
        {!props.entry.implicitInvocationEnabled ? <Badge variant="outline">manual</Badge> : null}
        {!props.entry.userInvocable ? <Badge variant="outline">hidden</Badge> : null}
        {props.entry.argumentHint ? (
          <Badge variant="outline">args {props.entry.argumentHint}</Badge>
        ) : null}
      </div>

      <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        {installStateSummary(props.entry.installState)}
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {props.entry.context ? (
          <Badge variant="outline">context {props.entry.context}</Badge>
        ) : null}
        {props.entry.model ? <Badge variant="outline">model {props.entry.model}</Badge> : null}
        {props.entry.effort ? <Badge variant="outline">effort {props.entry.effort}</Badge> : null}
        {props.entry.license ? <Badge variant="outline">{props.entry.license}</Badge> : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select
          value={props.selectedTarget}
          onValueChange={(value) => {
            if (value !== "all" && value !== "codex" && value !== "claudeAgent") {
              return;
            }
            props.onTargetChange(value);
          }}
        >
          <SelectTrigger
            className="w-full sm:w-52"
            aria-label={`Install target for ${props.entry.name}`}
          >
            <SelectValue>{HARNESS_TARGET_LABELS[props.selectedTarget]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start">
            {props.supportedTargets.map((target) => (
              <SelectItem key={target} value={target}>
                {HARNESS_TARGET_LABELS[target]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={props.isBusy || !props.selectedTargetInstalled}
            onClick={props.onUninstall}
          >
            Remove
          </Button>
          <Button disabled={props.isBusy} onClick={props.onInstall}>
            {props.selectedTargetInstalled ? "Reinstall" : "Install"}
          </Button>
        </div>
      </div>
    </article>
  );
}

export const Route = createFileRoute("/_chat/skills")({
  component: SkillsRouteView,
});
