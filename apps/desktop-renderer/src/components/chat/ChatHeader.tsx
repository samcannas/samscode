/**
 * JetBrains-style integrated titlebar header.
 *
 * Layout (left to right):
 *   [Logo] [Hamburger] [Project Selector] [Branch Selector]
 *                      ── drag spacer ──
 *   [Actions Dropdown + Play] ── gap ── [Settings] [Window Controls]
 */

import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@samscode/contracts";
import { memo } from "react";
import { PlayIcon, SettingsIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { ProjectSelector } from "../ProjectSelector";
import { HeaderBranchSelector } from "../HeaderBranchSelector";
import { HamburgerMenu } from "../HamburgerMenu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import appLogoUrl from "../../../../../assets/prod/logo.svg";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

export function AppLogo() {
  return <img src={appLogoUrl} alt="Sam's Code" className="size-5 shrink-0 rounded-[4px]" />;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: ChatHeaderProps) {
  const navigate = useNavigate();

  // Determine primary script for the play button
  const primaryScript = activeProjectScripts?.[0] ?? null;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {/* ── Left cluster: logo + hamburger + project + branch ── */}
      <div
        className="flex items-center gap-1 shrink-0"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <AppLogo />

        <HamburgerMenu
          isGitRepo={isGitRepo}
          terminalAvailable={terminalAvailable}
          terminalOpen={terminalOpen}
          diffOpen={diffOpen}
          onToggleTerminal={onToggleTerminal}
          onToggleDiff={onToggleDiff}
        />

        <ProjectSelector />

        {isGitRepo && (
          <HeaderBranchSelector
            threadId={activeThreadId}
            onCheckoutPullRequestRequest={onCheckoutPullRequestRequest}
            onComposerFocusRequest={onComposerFocusRequest}
          />
        )}
      </div>

      {/* ── Drag-absorbing spacer ── */}
      <div className="min-w-4 flex-1" />

      {/* ── Right cluster: actions + play + settings ── */}
      <div
        className="flex items-center gap-1 shrink-0"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Actions dropdown (project scripts) */}
        {activeProjectScripts && activeProjectScripts.length > 0 && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}

        {/* Play button */}
        {primaryScript && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Run ${primaryScript.name}`}
                  className="inline-flex items-center justify-center size-[30px] rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors duration-100 cursor-pointer"
                  onClick={() => onRunProjectScript(primaryScript)}
                />
              }
            >
              <PlayIcon className="size-3.5 fill-current" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Run {primaryScript.name}</TooltipPopup>
          </Tooltip>
        )}

        {/* Spacer */}
        <div className="w-2" />

        {/* Settings gear */}
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
    </div>
  );
});
