import type { ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import {
  HARNESS_TARGET_LABELS,
  installStateSummary,
  type HarnessInstallTarget,
} from "~/lib/harnessInstallTargets";

export interface CatalogCardEntry {
  id: string;
  name: string;
  description: string;
  category?: string | undefined;
  source: "workspace" | "user";
  installState: { codex: boolean; claudeAgent: boolean };
}

export interface CatalogCardProps {
  entry: CatalogCardEntry;
  selectedTarget: HarnessInstallTarget;
  selectedTargetInstalled: boolean;
  supportedTargets: readonly HarnessInstallTarget[];
  isBusy: boolean;
  onTargetChange: (target: HarnessInstallTarget) => void;
  onInstall: () => void;
  onUninstall: () => void;
  /** Middot-separated inline text appended below description (e.g. "model: gpt-4o · effort: high") */
  metaText?: string | undefined;
  /** Content rendered inside a tooltip on the info icon */
  detailsTooltip?: ReactNode | undefined;
}

export function CatalogCard(props: CatalogCardProps) {
  const { entry } = props;
  const installLabel = installStateSummary(entry.installState);

  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
      {/* Row 1: Name, ID, install dots, badges, info icon */}
      <div className="flex items-center gap-1.5 min-w-0">
        <h2 className="text-sm font-semibold truncate text-foreground">{entry.name}</h2>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">/{entry.id}</span>

        {/* Install status dots */}
        <Tooltip>
          <TooltipTrigger className="ml-0.5 flex shrink-0 items-center gap-1">
            <span
              className={`size-2 rounded-full ${entry.installState.codex ? "bg-success" : "bg-muted-foreground/25"}`}
              aria-label={`Codex: ${entry.installState.codex ? "installed" : "not installed"}`}
            />
            <span
              className={`size-2 rounded-full ${entry.installState.claudeAgent ? "bg-success" : "bg-muted-foreground/25"}`}
              aria-label={`Claude Code: ${entry.installState.claudeAgent ? "installed" : "not installed"}`}
            />
          </TooltipTrigger>
          <TooltipPopup className="px-2 py-1">{installLabel}</TooltipPopup>
        </Tooltip>

        <Badge size="sm" variant="outline" className="ml-1">
          {entry.source}
        </Badge>
        {entry.category ? (
          <Badge size="sm" variant="outline">
            {entry.category}
          </Badge>
        ) : null}

        {/* Info tooltip for secondary metadata */}
        {props.detailsTooltip ? (
          <Tooltip>
            <TooltipTrigger className="ml-auto shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              <InfoIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup className="max-w-64 px-2.5 py-1.5 text-xs leading-relaxed">
              {props.detailsTooltip}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>

      {/* Row 2: Description + inline metadata */}
      <div className="min-w-0">
        <p
          className="text-xs leading-normal text-muted-foreground line-clamp-2"
          title={entry.description}
        >
          {entry.description}
        </p>
        {props.metaText ? (
          <p className="mt-0.5 text-[11px] leading-normal text-muted-foreground/60 truncate">
            {props.metaText}
          </p>
        ) : null}
      </div>

      {/* Row 3: Install controls */}
      <div className="flex items-center gap-1.5">
        <Select
          value={props.selectedTarget}
          onValueChange={(value) => {
            if (value !== "all" && value !== "codex" && value !== "claudeAgent") {
              return;
            }
            props.onTargetChange(value);
          }}
        >
          <SelectTrigger size="xs" className="w-36" aria-label={`Install target for ${entry.name}`}>
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
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            disabled={props.isBusy || !props.selectedTargetInstalled}
            onClick={props.onUninstall}
          >
            Remove
          </Button>
          <Button size="xs" disabled={props.isBusy} onClick={props.onInstall}>
            {props.selectedTargetInstalled ? "Reinstall" : "Install"}
          </Button>
        </div>
      </div>
    </article>
  );
}
