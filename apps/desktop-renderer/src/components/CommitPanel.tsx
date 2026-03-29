/**
 * JetBrains-style commit panel for the sidebar.
 * Shows changed files, commit message, and commit/push actions.
 * Reuses GitActionsControl logic via direct git queries.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useStore } from "../store";
import { useAppSettings } from "../appSettings";
import {
  gitStatusQueryOptions,
  gitRunStackedActionMutationOptions,
  invalidateGitQueries,
} from "../lib/gitReactQuery";
import { toastManager } from "./ui/toast";

export function CommitPanel() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const { settings } = useAppSettings();
  const queryClient = useQueryClient();

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  );

  // Find active thread to get gitCwd (worktree or project cwd)
  const activeThread = useMemo(() => {
    if (!activeProject) return null;
    const projectThreads = threads.filter((t) => t.projectId === activeProject.id);
    return projectThreads[0] ?? null;
  }, [activeProject, threads]);

  const gitCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;

  const { data: gitStatus = null } = useQuery({
    ...gitStatusQueryOptions(gitCwd),
    refetchInterval: 5_000,
  });

  const allFiles = gitStatus?.workingTree.files ?? [];
  const hasChanges = gitStatus?.hasWorkingTreeChanges ?? false;

  const [commitMessage, setCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [amend, setAmend] = useState(false);

  const selectedFiles = allFiles.filter((f) => !excludedFiles.has(f.path));
  const allSelected = excludedFiles.size === 0;
  const noneSelected = selectedFiles.length === 0;

  const runActionMutation = useMutation(
    gitRunStackedActionMutationOptions({
      cwd: gitCwd,
      queryClient,
      model: settings.textGenerationModel ?? null,
    }),
  );
  const isBusy = runActionMutation.isPending;

  const toggleFile = useCallback((path: string) => {
    setExcludedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setExcludedFiles(new Set(allFiles.map((f) => f.path)));
    } else {
      setExcludedFiles(new Set());
    }
  }, [allSelected, allFiles]);

  const handleCommit = useCallback(async () => {
    if (isBusy || noneSelected || !gitCwd) return;

    try {
      const result = await runActionMutation.mutateAsync({
        action: "commit",
        ...(commitMessage.trim() ? { commitMessage: commitMessage.trim() } : {}),
        ...(allSelected ? {} : { filePaths: selectedFiles.map((f) => f.path) }),
      });
      if (result.commit.status === "created") {
        toastManager.add({ type: "success", title: "Changes committed" });
        setCommitMessage("");
        setExcludedFiles(new Set());
      } else {
        toastManager.add({
          type: "warning",
          title: "No changes to commit",
          description: "Working tree is clean.",
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Commit failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  }, [isBusy, noneSelected, gitCwd, commitMessage, allSelected, selectedFiles, runActionMutation]);

  const handleCommitAndPush = useCallback(async () => {
    if (isBusy || noneSelected || !gitCwd) return;

    try {
      const result = await runActionMutation.mutateAsync({
        action: "commit_push",
        ...(commitMessage.trim() ? { commitMessage: commitMessage.trim() } : {}),
        ...(allSelected ? {} : { filePaths: selectedFiles.map((f) => f.path) }),
      });
      if (result.commit.status === "created" && result.push.status === "pushed") {
        toastManager.add({ type: "success", title: "Changes committed and pushed" });
        setCommitMessage("");
        setExcludedFiles(new Set());
      } else if (result.commit.status === "created") {
        toastManager.add({
          type: "success",
          title: "Committed",
          description: "Push was skipped (already up to date).",
        });
        setCommitMessage("");
        setExcludedFiles(new Set());
      } else {
        toastManager.add({
          type: "warning",
          title: "No changes to commit",
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Commit & push failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  }, [isBusy, noneSelected, gitCwd, commitMessage, allSelected, selectedFiles, runActionMutation]);

  const handleRefresh = useCallback(() => {
    void invalidateGitQueries(queryClient);
  }, [queryClient]);

  if (!gitCwd) {
    return (
      <div className="flex flex-col h-full bg-floating-surface">
        <div className="flex items-center justify-between h-[34px] px-3 border-b border-white/[0.04] shrink-0">
          <span className="text-xs font-semibold text-surface-tool-foreground uppercase tracking-wide">
            Commit
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-muted-foreground/60">No project selected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-floating-surface">
      {/* Panel header */}
      <div className="flex items-center justify-between h-[34px] px-3 border-b border-white/[0.04] shrink-0">
        <span className="text-xs font-semibold text-surface-tool-foreground uppercase tracking-wide">
          Commit
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Refresh"
            className="inline-flex items-center justify-center size-6 rounded-[3px] text-muted-foreground/60 hover:bg-white/[0.08] hover:text-foreground transition-colors duration-75"
            onClick={handleRefresh}
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Changes file list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Changes header */}
        <button
          type="button"
          className="flex items-center gap-1.5 w-full h-[24px] px-3 text-[13px] text-surface-tool-foreground hover:bg-white/[0.04] cursor-pointer transition-colors duration-75"
          onClick={() => setChangesExpanded(!changesExpanded)}
        >
          {changesExpanded ? (
            <ChevronDownIcon className="size-3 shrink-0" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0" />
          )}
          <span className="font-medium">Changes</span>
          <span className="text-muted-foreground/60 ml-0.5">
            {allFiles.length} file{allFiles.length !== 1 ? "s" : ""}
          </span>
        </button>

        {changesExpanded && (
          <div className="pl-3">
            {allFiles.map((file) => {
              const isExcluded = excludedFiles.has(file.path);
              const fileName = file.path.split(/[/\\]/).pop() ?? file.path;
              const dirPath = file.path.includes("/")
                ? file.path.substring(0, file.path.lastIndexOf("/"))
                : "";

              return (
                <div
                  key={file.path}
                  className="group flex items-center gap-1.5 h-[24px] px-2 text-[13px] text-surface-tool-foreground hover:bg-white/[0.04] cursor-pointer transition-colors duration-75"
                  onClick={() => toggleFile(file.path)}
                >
                  {/* Checkbox */}
                  <span
                    className={`inline-flex items-center justify-center size-3.5 rounded-sm border transition-colors ${
                      isExcluded
                        ? "border-white/[0.12] bg-transparent"
                        : "border-primary bg-primary text-primary-foreground"
                    }`}
                  >
                    {!isExcluded && <CheckIcon className="size-2.5" />}
                  </span>

                  {/* Diff stats */}
                  <span className="text-[11px] font-mono shrink-0">
                    {isExcluded ? (
                      <span className="text-muted-foreground/40">--</span>
                    ) : (
                      <>
                        <span className="text-emerald-400">+{file.insertions}</span>
                        <span className="text-muted-foreground/40">/</span>
                        <span className="text-rose-400">-{file.deletions}</span>
                      </>
                    )}
                  </span>

                  {/* File name */}
                  <span
                    className={`truncate ${isExcluded ? "text-muted-foreground/50 line-through" : ""}`}
                  >
                    {fileName}
                  </span>

                  {/* Dir path */}
                  {dirPath && (
                    <span className="text-[11px] text-muted-foreground/40 truncate ml-1">
                      {dirPath}
                    </span>
                  )}
                </div>
              );
            })}

            {allFiles.length === 0 && (
              <div className="px-5 py-4 text-center text-xs text-muted-foreground/60">
                No changes
              </div>
            )}
          </div>
        )}
      </div>

      {/* Amend checkbox */}
      <div className="flex items-center gap-2 h-[28px] px-3 border-t border-white/[0.04]">
        <label className="flex items-center gap-1.5 text-[13px] text-surface-tool-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => setAmend(e.target.checked)}
            className="size-3.5 rounded-sm accent-primary"
          />
          Amend
        </label>
      </div>

      {/* Commit message textarea */}
      <div className="px-3 py-2 border-t border-white/[0.04]">
        <textarea
          className="w-full min-h-[60px] resize-y rounded-[4px] border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/40 transition-colors duration-100 focus:border-primary focus:ring-1 focus:ring-primary/30 focus:bg-white/[0.04] focus:outline-none"
          placeholder="Commit Message"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleCommit();
            }
          }}
        />
      </div>

      {/* Bottom action bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-white/[0.04] shrink-0">
        <button
          type="button"
          className="h-[28px] rounded-[4px] px-3 text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          disabled={isBusy || (noneSelected && hasChanges) || !hasChanges}
          onClick={() => void handleCommit()}
        >
          Commit
        </button>
        <button
          type="button"
          className="h-[28px] rounded-[4px] px-3 text-[13px] font-medium border border-border text-foreground hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          disabled={isBusy || (noneSelected && hasChanges) || !hasChanges}
          onClick={() => void handleCommitAndPush()}
        >
          Commit and Push...
        </button>
      </div>
    </div>
  );
}
