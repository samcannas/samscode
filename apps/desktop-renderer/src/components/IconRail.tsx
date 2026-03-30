/**
 * JetBrains-style narrow icon rail on the left edge.
 * Contains tool window toggles plus navigation shortcuts for non-thread pages.
 */

import { MessagesSquareIcon, GitCommitHorizontalIcon, BookCopyIcon, BotIcon } from "lucide-react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useStore } from "../store";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

type SidePanel = "threads" | "commit" | null;

interface IconRailProps {
  className?: string;
}

interface RailButtonProps {
  icon: React.ReactNode;
  label: string;
  panel: SidePanel;
  active: boolean;
  onClick: () => void;
}

function RailButton({ icon, label, active, onClick }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            className={`relative inline-flex items-center justify-center size-[32px] rounded-[4px] transition-colors duration-75 cursor-pointer ${
              active
                ? "bg-white/[0.08] text-foreground"
                : "text-icon-rail-foreground hover:bg-white/[0.06] hover:text-foreground"
            }`}
            onClick={onClick}
          />
        }
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />
        )}
        {icon}
      </TooltipTrigger>
      <TooltipPopup side="right" sideOffset={6}>
        {label}
      </TooltipPopup>
    </Tooltip>
  );
}

interface NavRailButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavRailButton({ icon, label, active, onClick }: NavRailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={`inline-flex items-center justify-center size-[32px] rounded-[4px] transition-colors duration-75 cursor-pointer ${
              active
                ? "bg-white/[0.08] text-foreground"
                : "text-icon-rail-foreground hover:bg-white/[0.06] hover:text-foreground"
            }`}
            onClick={onClick}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipPopup side="right" sideOffset={6}>
        {label}
      </TooltipPopup>
    </Tooltip>
  );
}

export function IconRail({ className = "" }: IconRailProps) {
  const activeSidePanel = useStore((s) => s.activeSidePanel);
  const setActiveSidePanel = useStore((s) => s.setActiveSidePanel);
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isOnSkills = pathname === "/skills";
  const isOnAgents = pathname === "/agents";

  const handlePanelClick = (panel: SidePanel) => {
    if (activeSidePanel === panel) {
      // Toggle off
      setActiveSidePanel(null);
    } else {
      setActiveSidePanel(panel);
    }
  };

  return (
    <div className={`flex flex-col items-center w-10 h-full pb-1 shrink-0 gap-0.5 ${className}`}>
      {/* Top group: primary tool windows */}
      <div className="flex flex-col items-center gap-0.5">
        <RailButton
          icon={<MessagesSquareIcon className="size-[18px]" />}
          label="Sessions"
          panel="threads"
          active={activeSidePanel === "threads"}
          onClick={() => handlePanelClick("threads")}
        />
        <RailButton
          icon={<GitCommitHorizontalIcon className="size-[18px]" />}
          label="Commit"
          panel="commit"
          active={activeSidePanel === "commit"}
          onClick={() => handlePanelClick("commit")}
        />
      </div>

      {/* Bottom group: navigation */}
      <div className="mt-auto flex flex-col items-center gap-0.5 pb-1">
        <NavRailButton
          icon={<BookCopyIcon className="size-[18px]" />}
          label="Skills"
          active={isOnSkills}
          onClick={() => void navigate({ to: "/skills" })}
        />
        <NavRailButton
          icon={<BotIcon className="size-[18px]" />}
          label="Agents"
          active={isOnAgents}
          onClick={() => void navigate({ to: "/agents" })}
        />
      </div>
    </div>
  );
}
