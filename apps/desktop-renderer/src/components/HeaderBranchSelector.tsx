/**
 * JetBrains-style branch selector for the top bar.
 * Wraps the existing BranchToolbarBranchSelector with a compact pill-shaped trigger.
 */

import { type ThreadId } from "@samscode/contracts";
import { GitBranchIcon } from "lucide-react";
import { useCallback } from "react";

import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import {
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
} from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";

interface HeaderBranchSelectorProps {
  threadId: ThreadId | null;
  className?: string;
  onCheckoutPullRequestRequest?: ((reference: string) => void) | undefined;
  onComposerFocusRequest?: (() => void) | undefined;
}

export function HeaderBranchSelector({
  threadId,
  className = "",
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: HeaderBranchSelectorProps) {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const setThreadBranchAction = useStore((store) => store.setThreadBranch);
  const draftThread = useComposerDraftStore((store) =>
    threadId ? store.getDraftThread(threadId) : null,
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);

  const serverThread = threadId ? threads.find((t) => t.id === threadId) : undefined;
  const activeProjectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeThreadId = serverThread?.id ?? (draftThread && threadId ? threadId : undefined);
  const activeThreadBranch = serverThread?.branch ?? draftThread?.branch ?? null;
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const branchCwd = activeWorktreePath ?? activeProject?.cwd ?? null;
  const hasServerThread = serverThread !== undefined;
  const effectiveEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread,
    draftThreadEnvMode: draftThread?.envMode,
  });

  const setThreadBranch = useCallback(
    (branch: string | null, worktreePath: string | null) => {
      if (!activeThreadId) return;
      const api = readNativeApi();
      if (serverThread?.session && worktreePath !== activeWorktreePath && api) {
        void api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId: activeThreadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      if (api && hasServerThread) {
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThreadId,
          branch,
          worktreePath,
        });
      }
      if (hasServerThread) {
        setThreadBranchAction(activeThreadId, branch, worktreePath);
        return;
      }
      if (!threadId) return;
      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(threadId, {
        branch,
        worktreePath,
        envMode: nextDraftEnvMode,
      });
    },
    [
      activeThreadId,
      serverThread?.session,
      activeWorktreePath,
      hasServerThread,
      setThreadBranchAction,
      setDraftThreadContext,
      threadId,
      effectiveEnvMode,
    ],
  );

  if (!activeThreadId || !activeProject) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-md px-2 h-[30px] text-sm text-titlebar-foreground/40 opacity-60 ${className}`}
      >
        <GitBranchIcon className="size-3.5 opacity-70" />
        <span className="text-sm">No branch</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <BranchToolbarBranchSelector
        activeProjectCwd={activeProject.cwd}
        activeThreadBranch={activeThreadBranch}
        activeWorktreePath={activeWorktreePath}
        branchCwd={branchCwd}
        effectiveEnvMode={effectiveEnvMode}
        envLocked={hasServerThread}
        onSetThreadBranch={setThreadBranch}
        triggerRender={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md px-2 h-[30px] text-sm text-titlebar-foreground hover:bg-white/[0.06] transition-colors duration-75 cursor-pointer"
          />
        }
        triggerClassName="gap-1.5 [&_svg.lucide-chevron-down]:size-3 [&_svg.lucide-chevron-down]:opacity-50"
        popupAlign="start"
        popupSide="bottom"
        {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
        {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
      />
    </div>
  );
}
