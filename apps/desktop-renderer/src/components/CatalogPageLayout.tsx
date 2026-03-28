import type { ReactNode } from "react";
import { FolderIcon, RefreshCcwIcon } from "lucide-react";
import { TitlebarControls } from "./WindowControlsOverlay";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SidebarInset } from "~/components/ui/sidebar";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";

export interface CatalogPageLayoutProps {
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  catalogPath: string | undefined;
  catalogHint: string;
  isLoading: boolean;
  isEmpty: boolean;
  onRefresh: () => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  emptyTitle: string;
  emptyDescription: string;
  children: ReactNode;
}

export function CatalogPageLayout(props: CatalogPageLayoutProps) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {/* Titlebar drag region */}
        <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
            {props.title}
          </span>
          <TitlebarControls />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            {/* Header: title + subtitle */}
            <header className="flex items-baseline gap-3">
              <h1 className="text-lg font-semibold tracking-tight text-foreground">
                {props.title}
              </h1>
              <p className="text-xs text-muted-foreground">{props.subtitle}</p>
            </header>

            {/* Toolbar: search + refresh + catalog path */}
            <div className="flex items-center gap-2">
              <Input
                value={props.searchValue}
                onChange={(event) => props.onSearchChange(event.target.value)}
                placeholder={props.searchPlaceholder}
                className="max-w-64"
              />
              <Button size="icon-xs" variant="outline" onClick={props.onRefresh}>
                <RefreshCcwIcon className="size-3.5" />
              </Button>
              {props.catalogPath ? (
                <Tooltip>
                  <TooltipTrigger className="ml-auto shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                    <FolderIcon className="size-4" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom" className="max-w-sm px-3 py-2">
                    <p className="text-xs font-medium text-foreground">Catalog folder</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {props.catalogPath}
                    </p>
                    <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                      {props.catalogHint}
                    </p>
                  </TooltipPopup>
                </Tooltip>
              ) : null}
            </div>

            {/* Card grid */}
            <section className="grid gap-3 lg:grid-cols-2">{props.children}</section>

            {/* Empty state */}
            {!props.isLoading && props.isEmpty ? (
              <section className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
                <p className="text-sm font-medium text-foreground">{props.emptyTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">{props.emptyDescription}</p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
