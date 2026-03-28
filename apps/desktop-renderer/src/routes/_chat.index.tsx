import { createFileRoute } from "@tanstack/react-router";
import { TitlebarControls } from "~/components/WindowControlsOverlay";

function ChatIndexRouteView() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
      <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
        <span className="text-xs text-muted-foreground/50">No active thread</span>
        <TitlebarControls />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one to get started.</p>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
