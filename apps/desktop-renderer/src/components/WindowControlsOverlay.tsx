/**
 * Titlebar window controls rendered as a direct child of a `.drag-region`
 * header element.
 *
 * Electron resolves `-webkit-app-region` at the compositor level using the
 * DOM parent–child relationship, NOT paint/z-index order.  A `position: fixed`
 * element in a separate stacking context cannot override a `drag` region
 * underneath it.  The `no-drag` declaration **must** come from a DOM child
 * of the drag-region element.
 *
 * This component renders inline as a flex child so the controls naturally
 * sit at the right edge of the header bar.
 *
 * Usage — add as the last child inside any `drag-region` header:
 *
 *   <header className="drag-region flex h-[52px] items-center ...">
 *     <ChatHeader ... />
 *     <TitlebarControls />
 *   </header>
 */

import { WindowControls } from "./WindowControls";
import { useWindowControls } from "~/hooks/useWindowControls";

export function TitlebarControls() {
  const { showControls, isMaximized, minimize, maximize, close } = useWindowControls();

  if (!showControls) return null;

  return (
    <div
      className="flex shrink-0 self-stretch items-stretch"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <WindowControls
        isMaximized={isMaximized}
        onMinimize={minimize}
        onMaximize={maximize}
        onClose={close}
      />
    </div>
  );
}
