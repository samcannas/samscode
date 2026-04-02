/**
 * JetBrains-style project selector for the top bar.
 * Shows the active project name with a colored badge, opens a dropdown to switch projects.
 */

import { type ProjectId } from "@samscode/contracts";
import { ChevronDownIcon, FolderOpenIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "../store";
import { useAppSettings } from "../appSettings";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { ProjectBadge } from "./ProjectBadge";
import { hasNativeProjectFolderPicker, pickProjectFolder } from "../projectFolderPicker";
import { readNativeApi } from "../nativeApi";
import { newCommandId, newProjectId } from "../lib/utils";
import { DEFAULT_MODEL_BY_PROVIDER } from "@samscode/contracts";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import { toastManager } from "./ui/toast";
import { sortProjectsForSidebar, sortThreadsForSidebar } from "./Sidebar.logic";
import { type Project } from "../types";
import { getAdjacentProjectIdInCycle } from "./ProjectSelector.logic";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

const PROJECT_SCROLL_STEP_PX = 36;

/** Replace the user's home directory prefix with `~` for compact display. */
function shortenPath(cwd: string): string {
  // Windows: C:\Users\<user>\...  macOS: /Users/<user>/...  Linux: /home/<user>/...
  const match = cwd.match(/^([A-Z]:\\Users\\[^\\]+|\/(?:home|Users)\/[^/]+)(.*)/);
  if (match) {
    return "~" + match[2];
  }
  return cwd;
}

interface ProjectSelectorProps {
  className?: string;
}

export function ProjectSelector({ className = "" }: ProjectSelectorProps) {
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const { settings: appSettings } = useAppSettings();
  const navigate = useNavigate();
  const { handleNewThread } = useHandleNewThread();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const wheelDeltaRef = useRef(0);
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  );

  const sortedProjects = useMemo(
    () => sortProjectsForSidebar(projects, threads, appSettings.sidebarProjectSortOrder),
    [projects, threads, appSettings.sidebarProjectSortOrder],
  );

  const handleSelectProject = useCallback(
    (projectId: ProjectId) => {
      setActiveProject(projectId);
      setOpen(false);
      // Navigate to the most recent thread of this project
      const projectThreads = sortThreadsForSidebar(
        threads.filter((t) => t.projectId === projectId),
        appSettings.sidebarThreadSortOrder,
      );
      const latestThread = projectThreads[0];
      if (latestThread) {
        void navigate({
          to: "/$threadId",
          params: { threadId: latestThread.id },
        });
      }
    },
    [setActiveProject, threads, appSettings.sidebarThreadSortOrder, navigate],
  );

  const handleOpenProject = useCallback(async () => {
    setOpen(false);
    if (!hasNativeProjectFolderPicker()) return;
    try {
      const pickedPath = await pickProjectFolder();
      if (!pickedPath) return;

      const api = readNativeApi();
      if (!api) return;

      const existing = projects.find((p) => p.cwd === pickedPath);
      if (existing) {
        handleSelectProject(existing.id);
        return;
      }

      const projectId = newProjectId();
      const title = pickedPath.split(/[/\\]/).findLast(isNonEmptyString) ?? pickedPath;
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title,
        workspaceRoot: pickedPath,
        defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
        createdAt: new Date().toISOString(),
      });
      setActiveProject(projectId);
      await handleNewThread(projectId, {
        envMode: appSettings.defaultThreadEnvMode,
      }).catch(() => undefined);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to open project",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  }, [
    projects,
    handleSelectProject,
    handleNewThread,
    setActiveProject,
    appSettings.defaultThreadEnvMode,
  ]);

  const handleProjectContextMenu = useCallback(
    async (event: React.MouseEvent, project: Project) => {
      event.preventDefault();
      const api = readNativeApi();
      if (!api) return;

      const clicked = await api.contextMenu.show(
        [
          { id: "copy-path", label: "Copy Project Path" },
          { id: "remove", label: "Remove project", destructive: true },
        ],
        { x: event.clientX, y: event.clientY },
      );

      if (clicked === "copy-path") {
        copyPathToClipboard(project.cwd, { path: project.cwd });
        return;
      }

      if (clicked !== "remove") return;

      const confirmed = await api.dialogs.confirm(
        `Remove project "${project.name}"?\n\nThis removes it from Sam's Code but does not delete files on disk.`,
      );
      if (!confirmed) return;

      await api.orchestration.dispatchCommand({
        type: "project.delete",
        commandId: newCommandId(),
        projectId: project.id,
      });

      // If we just removed the active project, switch to the next one
      if (project.id === activeProjectId) {
        const remaining = projects.filter((p) => p.id !== project.id);
        setActiveProject(remaining[0]?.id ?? null);
        if (remaining.length === 0) {
          void navigate({ to: "/" });
        }
      }
    },
    [activeProjectId, copyPathToClipboard, navigate, projects, setActiveProject],
  );

  // Close dropdown when clicking outside
  const handleBackdropClick = useCallback(() => {
    setOpen(false);
  }, []);

  const resetWheelDelta = useCallback(() => {
    wheelDeltaRef.current = 0;
  }, []);

  const handleTriggerWheel = useCallback(
    (event: React.WheelEvent<HTMLButtonElement>) => {
      if (open || sortedProjects.length < 2 || activeProject === null) {
        return;
      }

      const dominantDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (dominantDelta === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      let accumulatedDelta = wheelDeltaRef.current + dominantDelta;
      let nextProjectId: string | null = activeProject.id;

      while (Math.abs(accumulatedDelta) >= PROJECT_SCROLL_STEP_PX) {
        const direction = accumulatedDelta > 0 ? 1 : -1;
        nextProjectId = getAdjacentProjectIdInCycle(sortedProjects, nextProjectId, direction);
        accumulatedDelta -= PROJECT_SCROLL_STEP_PX * direction;
      }

      wheelDeltaRef.current = accumulatedDelta;

      if (nextProjectId !== null && nextProjectId !== activeProject.id) {
        handleSelectProject(nextProjectId as ProjectId);
      }
    },
    [activeProject, handleSelectProject, open, sortedProjects],
  );

  if (!activeProject) {
    return (
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 rounded-md px-2 h-[30px] text-sm font-medium text-titlebar-foreground/50 hover:bg-white/[0.06] transition-colors duration-75 cursor-pointer ${className}`}
        onClick={() => void handleOpenProject()}
      >
        <FolderOpenIcon className="size-3.5" />
        Open project
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={`inline-flex items-center gap-1.5 rounded-md px-2 h-[30px] text-sm font-medium text-titlebar-foreground hover:bg-white/[0.06] transition-colors duration-75 cursor-pointer ${className}`}
        onClick={() => setOpen(!open)}
        onMouseLeave={resetWheelDelta}
        onWheel={handleTriggerWheel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <ProjectBadge name={activeProject.name} />
        <span className="max-w-[160px] truncate">{activeProject.name}</span>
        <ChevronDownIcon className="size-3 opacity-50 ml-0.5" />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={handleBackdropClick} />

          {/* Dropdown */}
          <div
            ref={dropdownRef}
            className="absolute left-0 top-full mt-1 z-50 w-[320px] rounded-lg border border-white/[0.06] bg-popover shadow-[0_8px_24px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] py-1 animate-in fade-in-0 zoom-in-95 duration-100"
            role="listbox"
          >
            {/* Top actions */}
            <button
              type="button"
              className="flex w-full items-center gap-2 h-[32px] px-3 text-sm text-popover-foreground hover:bg-white/[0.06] cursor-pointer transition-colors duration-75"
              onClick={() => void handleOpenProject()}
            >
              <FolderOpenIcon className="size-4 opacity-60" />
              Open...
            </button>

            {/* Divider */}
            <div className="h-px bg-white/[0.06] my-1" />

            {/* Projects header */}
            {sortedProjects.length > 0 && (
              <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 select-none">
                Projects
              </div>
            )}

            {/* Project list */}
            {sortedProjects.map((project) => {
              const isCurrent = project.id === activeProject.id;
              return (
                <button
                  key={project.id}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  className={`flex w-full items-center gap-2.5 h-[40px] px-3 cursor-pointer transition-colors duration-75 ${
                    isCurrent ? "bg-primary/10 hover:bg-primary/14" : "hover:bg-white/[0.06]"
                  }`}
                  onClick={() => handleSelectProject(project.id)}
                  onContextMenu={(e) => void handleProjectContextMenu(e, project)}
                >
                  <ProjectBadge name={project.name} size="md" />
                  <div className="flex flex-col min-w-0 items-start">
                    <span className="text-sm font-medium text-popover-foreground truncate max-w-full">
                      {project.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground/60 truncate max-w-full">
                      {shortenPath(project.cwd)}
                    </span>
                  </div>
                </button>
              );
            })}

            {sortedProjects.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground/60">
                No projects yet
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
