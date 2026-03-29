import { type EditorId, type ResolvedKeybindingsConfig, ThreadId } from "@samscode/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Outlet,
  createFileRoute,
  useNavigate,
  useLocation,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { SettingsIcon } from "lucide-react";

import ThreadSidebar from "../components/Sidebar";
import { IconRail } from "../components/IconRail";
import { CommitPanel } from "../components/CommitPanel";
import { AppLogo } from "../components/chat/ChatHeader";
import { ProjectSelector } from "../components/ProjectSelector";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { HeaderBranchSelector } from "../components/HeaderBranchSelector";
import { TitlebarControls } from "../components/WindowControlsOverlay";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { isTerminalFocused } from "../lib/terminalFocus";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { gitBranchesQueryOptions } from "../lib/gitReactQuery";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { stripDiffSearchParams } from "../diffRouteSearch";
import { Sidebar, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { resolveSidebarNewThreadEnvMode } from "~/components/Sidebar.logic";
import { useAppSettings } from "~/appSettings";
import { useStore } from "~/store";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const EMPTY_AVAILABLE_EDITORS: ReadonlyArray<EditorId> = [];
const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadIdsSize = useThreadSelectionStore((state) => state.selectedThreadIds.size);
  const { activeDraftThread, activeThread, handleNewThread, projects, routeThreadId } =
    useHandleNewThread();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadId
      ? selectThreadTerminalState(state.terminalStateByThreadId, routeThreadId).terminalOpen
      : false,
  );
  const { settings: appSettings } = useAppSettings();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && selectedThreadIdsSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
      if (!projectId) return;

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(projectId, {
          envMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: appSettings.defaultThreadEnvMode,
          }),
        });
        return;
      }

      if (command !== "chat.new") return;
      event.preventDefault();
      event.stopPropagation();
      void handleNewThread(projectId, {
        branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
        envMode: activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
      });
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    projects,
    selectedThreadIdsSize,
    terminalOpen,
    appSettings.defaultThreadEnvMode,
  ]);

  return null;
}

const NON_THREAD_ROUTES = ["/", "/settings", "/skills", "/agents"];

function ChatRouteLayout() {
  const navigate = useNavigate();
  const activeSidePanel = useStore((s) => s.activeSidePanel);
  const setActiveSidePanel = useStore((s) => s.setActiveSidePanel);
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const pathname = useLocation({ select: (l) => l.pathname });

  // Use useParams with strict: false to get the threadId from child routes
  const routeThreadId = useParams({
    strict: false,
    select: (params) =>
      "threadId" in params && typeof params.threadId === "string"
        ? ThreadId.makeUnsafe(params.threadId)
        : null,
  });

  // Get search params from child routes (diff state lives in URL)
  const rawSearch = useSearch({
    strict: false,
    select: (search) => search as Record<string, unknown>,
  });

  // Determine if we're on a thread route (not a named route)
  const isThreadRoute = !NON_THREAD_ROUTES.includes(pathname) && routeThreadId !== null;

  // ── Hamburger menu data ───────────────────────────────────────────
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const availableEditors = serverConfigQuery.data?.availableEditors ?? EMPTY_AVAILABLE_EDITORS;

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  );
  const activeThread = useMemo(
    () => (routeThreadId ? (threads.find((t) => t.id === routeThreadId) ?? null) : null),
    [threads, routeThreadId],
  );

  const gitCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const branchesQuery = useQuery(gitBranchesQueryOptions(gitCwd));
  const isGitRepo = branchesQuery.data?.isRepo ?? true;

  // Terminal state for active thread
  const terminalState = useTerminalStateStore((state) =>
    routeThreadId ? selectThreadTerminalState(state.terminalStateByThreadId, routeThreadId) : null,
  );
  const storeSetTerminalOpen = useTerminalStateStore((state) => state.setTerminalOpen);
  const terminalOpen = terminalState?.terminalOpen ?? false;

  // Diff state from URL search params
  const diffOpen = (rawSearch as Record<string, unknown>).diff === "1";

  const onToggleTerminal = useMemo(
    () =>
      isThreadRoute && routeThreadId
        ? () => storeSetTerminalOpen(routeThreadId, !terminalOpen)
        : undefined,
    [isThreadRoute, routeThreadId, storeSetTerminalOpen, terminalOpen],
  );

  const onToggleDiff = useMemo(
    () =>
      isThreadRoute && routeThreadId
        ? () => {
            void navigate({
              to: "/$threadId",
              params: { threadId: routeThreadId },
              replace: true,
              search: (previous) => {
                const rest = stripDiffSearchParams(previous as Record<string, unknown>);
                return diffOpen ? { ...rest, diff: undefined } : { ...rest, diff: "1" };
              },
            });
          }
        : undefined,
    [isThreadRoute, routeThreadId, navigate, diffOpen],
  );

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <div className="flex flex-col h-full bg-canvas">
      {/* Full-width titlebar — transparent chrome on the canvas */}
      <header className="drag-region relative z-30 flex h-10 shrink-0 items-center">
        {/* Logo area — matches icon rail width below */}
        <div
          className="flex w-10 shrink-0 items-center justify-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <AppLogo />
        </div>

        {/* Left cluster — starts at 40px, aligned with sidebar left edge */}
        <div
          className="flex items-center gap-1 shrink-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <HamburgerMenu
            availableEditors={availableEditors}
            openInCwd={gitCwd}
            terminalAvailable={isThreadRoute}
            terminalOpen={terminalOpen}
            diffOpen={diffOpen}
            isGitRepo={isGitRepo}
            gitCwd={gitCwd}
            activeThreadId={routeThreadId}
            onToggleTerminal={onToggleTerminal}
            onToggleDiff={onToggleDiff}
          />
          <ProjectSelector />
          {isThreadRoute && routeThreadId && <HeaderBranchSelector threadId={routeThreadId} />}
        </div>

        {/* Drag spacer */}
        <div className="min-w-4 flex-1" />

        {/* Right cluster */}
        <div
          className="flex items-center gap-1 shrink-0 pr-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Settings"
                  className="inline-flex items-center justify-center size-7 rounded-[4px] text-titlebar-foreground/60 hover:bg-white/[0.06] hover:text-titlebar-foreground transition-colors duration-75 cursor-pointer"
                  onClick={() => void navigate({ to: "/settings" })}
                />
              }
            >
              <SettingsIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Settings</TooltipPopup>
          </Tooltip>
        </div>
        <TitlebarControls />
      </header>

      {/* Below titlebar: icon rail + sidebar + content */}
      <div className="flex flex-1 min-h-0 [transform:translateZ(0)]">
        <ChatRouteGlobalShortcuts />
        <IconRail />

        {/*
          SidebarProvider must wrap both the sidebar AND main content.
          The sidebar uses fixed positioning; left-10 offsets it past the icon rail.
          We override w-full -> flex-1 and min-h-svh -> h-full so the wrapper
          lives inside the outer flex row instead of stretching to viewport width.
        */}
        <SidebarProvider
          defaultOpen
          open={activeSidePanel === "threads" || activeSidePanel === "commit"}
          onOpenChange={(isOpen) => {
            if (!isOpen) setActiveSidePanel(null);
          }}
          className="w-auto min-h-0 flex-1 min-w-0 h-full gap-1"
        >
          <Sidebar
            side="left"
            collapsible="offcanvas"
            className="border border-floating-border bg-floating-surface text-foreground left-10 h-full rounded-t-lg border-b-0 border-l-0 overflow-hidden"
            resizable={{
              minWidth: THREAD_SIDEBAR_MIN_WIDTH,
              shouldAcceptWidth: ({ nextWidth, wrapper }) =>
                wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
              storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
            }}
          >
            {activeSidePanel === "commit" ? <CommitPanel /> : <ThreadSidebar />}
            <SidebarRail />
          </Sidebar>

          {/* Main content -- Outlet renders SidebarInset + DiffPanelInlineSidebar as
             direct flex-row children so they share the remaining horizontal space. */}
          <Outlet />
        </SidebarProvider>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
