/**
 * JetBrains-style hamburger menu for the top bar.
 * Holds items that were removed from the top bar during the redesign:
 * - Open in editor (VS Code, Cursor, etc.)
 * - Toggle terminal drawer
 * - Toggle diff panel
 *
 * All props are optional so the menu can be rendered in routes that
 * do not have an active thread (settings, skills, agents, index).
 * Thread-specific items are hidden when their callbacks are absent.
 */

import { type EditorId } from "@samscode/contracts";
import { DiffIcon, FolderClosedIcon, MenuIcon, TerminalSquareIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { readNativeApi } from "../nativeApi";
import { usePreferredEditor } from "../editorPreferences";
import { isMacPlatform, isWindowsPlatform } from "../lib/utils";
import { AntigravityIcon, CursorIcon, VisualStudioCode, Zed } from "./Icons";

interface HamburgerMenuProps {
  className?: string;
  /** Editors the server reports as available on this machine. */
  availableEditors?: ReadonlyArray<EditorId> | undefined;
  /** Directory to open in an editor. */
  openInCwd?: string | null | undefined;
  terminalAvailable?: boolean | undefined;
  terminalOpen?: boolean | undefined;
  diffOpen?: boolean | undefined;
  isGitRepo?: boolean | undefined;
  onToggleTerminal?: (() => void) | undefined;
  onToggleDiff?: (() => void) | undefined;
}

const EDITOR_OPTIONS: ReadonlyArray<{
  label: string;
  value: EditorId;
  Icon: React.ComponentType<{ className?: string }>;
  platformLabel?: (platform: string) => string;
}> = [
  { label: "Cursor", value: "cursor", Icon: CursorIcon },
  { label: "VS Code", value: "vscode", Icon: VisualStudioCode },
  { label: "Zed", value: "zed", Icon: Zed },
  { label: "Antigravity", value: "antigravity", Icon: AntigravityIcon },
  {
    label: "File Manager",
    value: "file-manager",
    Icon: FolderClosedIcon,
    platformLabel: (p: string) =>
      isMacPlatform(p) ? "Finder" : isWindowsPlatform(p) ? "Explorer" : "Files",
  },
];

export function HamburgerMenu({
  className = "",
  availableEditors,
  openInCwd,
  terminalAvailable = false,
  terminalOpen = false,
  diffOpen = false,
  isGitRepo = false,
  onToggleTerminal,
  onToggleDiff,
}: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors ?? []);

  const editorOptions = useMemo(() => {
    if (!availableEditors || availableEditors.length === 0) return [];
    return EDITOR_OPTIONS.filter((o) => availableEditors.includes(o.value)).map((o) => ({
      ...o,
      label: o.platformLabel ? o.platformLabel(navigator.platform) : o.label,
    }));
  }, [availableEditors]);

  const openInEditor = useCallback(
    (editorId: EditorId) => {
      const api = readNativeApi();
      if (!api || !openInCwd) return;
      void api.shell.openInEditor(openInCwd, editorId);
      setPreferredEditor(editorId);
      setOpen(false);
    },
    [openInCwd, setPreferredEditor],
  );

  const hasTerminalAction = onToggleTerminal !== undefined;
  const hasDiffAction = onToggleDiff !== undefined;
  const hasEditorOptions = editorOptions.length > 0 && openInCwd;
  const hasAnyItem = hasTerminalAction || hasDiffAction || hasEditorOptions;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Main menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center justify-center size-7 rounded-[4px] text-titlebar-foreground/70 hover:bg-white/[0.06] hover:text-titlebar-foreground transition-colors duration-75 cursor-pointer ${className}`}
        onClick={() => setOpen(!open)}
      >
        <MenuIcon className="size-4" />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Dropdown */}
          <div
            className="absolute left-0 top-full mt-1 z-50 w-[220px] rounded-lg border border-white/[0.06] bg-popover shadow-[0_8px_24px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] py-1 animate-in fade-in-0 zoom-in-95 duration-100"
            role="menu"
          >
            {/* Open in editor section */}
            {hasEditorOptions && (
              <>
                <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 select-none">
                  Open in
                </div>
                {editorOptions.map(({ label, value, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 h-[32px] px-3 text-sm text-popover-foreground hover:bg-white/[0.06] cursor-pointer transition-colors duration-75"
                    onClick={() => openInEditor(value)}
                  >
                    <Icon className="size-4 opacity-60" />
                    <span>{label}</span>
                    {value === preferredEditor && (
                      <span className="ml-auto text-[10px] text-muted-foreground/40">default</span>
                    )}
                  </button>
                ))}
              </>
            )}

            {/* Divider between open-in and toggle sections */}
            {hasEditorOptions && (hasTerminalAction || hasDiffAction) && (
              <div className="h-px bg-white/[0.06] my-1" />
            )}

            {/* Terminal toggle */}
            {hasTerminalAction && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 h-[32px] px-3 text-sm text-popover-foreground hover:bg-white/[0.06] cursor-pointer transition-colors duration-75 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => {
                  setOpen(false);
                  onToggleTerminal();
                }}
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-4 opacity-60" />
                <span>{terminalOpen ? "Hide terminal" : "Show terminal"}</span>
              </button>
            )}

            {/* Diff panel toggle */}
            {hasDiffAction && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 h-[32px] px-3 text-sm text-popover-foreground hover:bg-white/[0.06] cursor-pointer transition-colors duration-75 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => {
                  setOpen(false);
                  onToggleDiff();
                }}
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-4 opacity-60" />
                <span>{diffOpen ? "Hide diff panel" : "Show diff panel"}</span>
              </button>
            )}

            {!hasAnyItem && (
              <div className="px-3 py-2 text-sm text-muted-foreground/60">No actions available</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
