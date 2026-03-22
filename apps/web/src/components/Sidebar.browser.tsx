import type { NativeApi } from "@samscode/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SidebarProvider } from "./ui/sidebar";

type MockProject = {
  id: string;
  name: string;
  cwd: string;
  expanded: boolean;
};

type MockThread = {
  id: string;
  projectId: string;
  createdAt: string;
  title: string;
  branch: string | null;
  worktreePath: string | null;
  activities: readonly unknown[];
};

const navigateMock = vi.fn();
const handleNewThreadMock = vi.fn().mockResolvedValue(undefined);
const dispatchCommandMock = vi.fn().mockResolvedValue(undefined);
const pickFolderMock = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
const toastAddMock = vi.fn();

let mockProjects: MockProject[] = [];
let mockThreads: MockThread[] = [];

vi.mock("../store", () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      projects: mockProjects,
      threads: mockThreads,
      markThreadUnread: vi.fn(),
      toggleProject: vi.fn(),
      reorderProjects: vi.fn(),
    }),
}));

vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      clearThreadDraft: vi.fn(),
      getDraftThreadByProjectId: () => null,
      clearProjectDraftThreadId: vi.fn(),
      clearProjectDraftThreadById: vi.fn(),
    }),
}));

vi.mock("../terminalStateStore", () => ({
  useTerminalStateStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      terminalStateByThreadId: {},
      clearTerminalState: vi.fn(),
    }),
  selectThreadTerminalState: () => ({ runningTerminalIds: [] }),
}));

vi.mock("../threadSelectionStore", () => ({
  useThreadSelectionStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedThreadIds: new Set(),
      toggleThread: vi.fn(),
      rangeSelectTo: vi.fn(),
      clearSelection: vi.fn(),
      removeFromSelection: vi.fn(),
      setAnchor: vi.fn(),
    }),
}));

vi.mock("../appSettings", () => ({
  useAppSettings: () => ({
    settings: {
      defaultThreadEnvMode: "worktree",
    },
  }),
}));

vi.mock("../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    handleNewThread: handleNewThreadMock,
  }),
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () =>
    ({
      dialogs: {
        pickFolder: pickFolderMock,
        confirm: vi.fn(),
      },
      orchestration: {
        dispatchCommand: dispatchCommandMock,
      },
      shell: {
        openExternal: vi.fn(),
      },
      contextMenu: {
        show: vi.fn(),
      },
      terminal: {
        onEvent: vi.fn(),
      },
    }) as unknown as NativeApi,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: "/" }),
  useParams: ({ select }: { select: (params: { threadId?: string }) => unknown }) => select({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false }),
  useQueries: () => [],
  useQuery: () => ({ data: { keybindings: [] } }),
  useQueryClient: () => ({}),
}));

vi.mock("../lib/gitReactQuery", () => ({
  gitRemoveWorktreeMutationOptions: () => ({}),
  gitStatusQueryOptions: () => ({}),
}));

vi.mock("../lib/serverReactQuery", () => ({
  serverConfigQueryOptions: () => ({}),
}));

vi.mock("./ui/toast", () => ({
  toastManager: {
    add: toastAddMock,
  },
}));

async function mountSidebar() {
  const host = document.createElement("div");
  document.body.append(host);
  const { default: Sidebar } = await import("./Sidebar");
  const screen = await render(
    <SidebarProvider>
      <Sidebar />
    </SidebarProvider>,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

function setDesktopPickerAvailable(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      writable: true,
      value: {
        pickFolder: pickFolderMock,
        getWsUrl: () => null,
      },
    });
    return;
  }

  Reflect.deleteProperty(window, "desktopBridge");
}

describe("Sidebar add project flow", () => {
  beforeEach(() => {
    mockProjects = [];
    mockThreads = [];
    navigateMock.mockReset();
    handleNewThreadMock.mockReset();
    handleNewThreadMock.mockResolvedValue(undefined);
    dispatchCommandMock.mockReset();
    dispatchCommandMock.mockResolvedValue(undefined);
    pickFolderMock.mockReset();
    pickFolderMock.mockResolvedValue(null);
    toastAddMock.mockReset();
    setDesktopPickerAvailable(false);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Reflect.deleteProperty(window, "desktopBridge");
  });

  it("opens the native picker immediately on desktop", async () => {
    setDesktopPickerAvailable(true);
    const mounted = await mountSidebar();

    try {
      await page.getByRole("button", { name: "Browse for project folder" }).click();

      await vi.waitFor(() => {
        expect(pickFolderMock).toHaveBeenCalledTimes(1);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not reveal path entry when the desktop picker is canceled", async () => {
    setDesktopPickerAvailable(true);
    pickFolderMock.mockResolvedValue(null);
    const mounted = await mountSidebar();

    try {
      await page.getByRole("button", { name: "Browse for project folder" }).click();

      await vi.waitFor(() => {
        expect(pickFolderMock).toHaveBeenCalledTimes(1);
      });
      expect(document.body.innerHTML).not.toContain('placeholder="/path/to/project"');
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a project from the picked desktop folder", async () => {
    setDesktopPickerAvailable(true);
    pickFolderMock.mockResolvedValue("/tmp/my-project");
    const mounted = await mountSidebar();

    try {
      await page.getByRole("button", { name: "Browse for project folder" }).click();

      await vi.waitFor(() => {
        expect(dispatchCommandMock).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "project.create",
            workspaceRoot: "/tmp/my-project",
            title: "my-project",
          }),
        );
      });
      expect(handleNewThreadMock).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("focuses the latest existing thread instead of creating a duplicate project", async () => {
    setDesktopPickerAvailable(true);
    mockProjects = [
      {
        id: "project-1",
        name: "Existing Project",
        cwd: "/tmp/existing-project",
        expanded: false,
      },
    ];
    mockThreads = [
      {
        id: "thread-1",
        projectId: "project-1",
        createdAt: "2026-03-21T10:00:00.000Z",
        title: "Old thread",
        branch: null,
        worktreePath: null,
        activities: [],
      },
      {
        id: "thread-2",
        projectId: "project-1",
        createdAt: "2026-03-22T10:00:00.000Z",
        title: "Latest thread",
        branch: null,
        worktreePath: null,
        activities: [],
      },
    ];
    pickFolderMock.mockResolvedValue("/tmp/existing-project");
    const mounted = await mountSidebar();

    try {
      await page.getByRole("button", { name: "Browse for project folder" }).click();

      await vi.waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith({
          to: "/$threadId",
          params: { threadId: "thread-2" },
        });
      });
      expect(dispatchCommandMock).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows a toast when desktop project creation fails after picking a folder", async () => {
    setDesktopPickerAvailable(true);
    pickFolderMock.mockResolvedValue("/tmp/failing-project");
    dispatchCommandMock.mockRejectedValue(new Error("Directory is invalid"));
    const mounted = await mountSidebar();

    try {
      await page.getByRole("button", { name: "Browse for project folder" }).click();

      await vi.waitFor(() => {
        expect(toastAddMock).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "error",
            title: "Failed to add project",
            description: "Directory is invalid",
          }),
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps manual path entry available as a desktop fallback", async () => {
    setDesktopPickerAvailable(true);
    const mounted = await mountSidebar();

    try {
      await page.getByRole("button", { name: "Add project by path" }).click();

      await vi.waitFor(() => {
        expect(document.body.innerHTML).toContain('placeholder="/path/to/project"');
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("submits the manual path fallback", async () => {
    const mounted = await mountSidebar();

    try {
      await page.getByRole("button", { name: "Add project" }).click();
      const input = page.getByPlaceholder("/path/to/project");
      await input.fill("/tmp/manual-project");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await vi.waitFor(() => {
        expect(dispatchCommandMock).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "project.create",
            workspaceRoot: "/tmp/manual-project",
            title: "manual-project",
          }),
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps inline errors in the manual path fallback", async () => {
    dispatchCommandMock.mockRejectedValue(new Error("Path is invalid"));
    const mounted = await mountSidebar();

    try {
      await page.getByRole("button", { name: "Add project" }).click();
      const input = page.getByPlaceholder("/path/to/project");
      await input.fill("/tmp/bad-project");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("Path is invalid");
      });
      expect(toastAddMock).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });
});
