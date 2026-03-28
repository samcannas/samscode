/**
 * Custom window control buttons for Linux (and frameless fallback).
 *
 * On Linux Electron uses `frame: false`, so we render our own
 * minimize / maximize-restore / close buttons styled to match the
 * JetBrains integrated-titlebar aesthetic: small, muted, and
 * unobtrusive until hovered.
 *
 * Each button is marked with `-webkit-app-region: no-drag` so it
 * stays clickable inside a drag-region header.
 */

export interface WindowControlsProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------
 * SVG icons – intentionally simple, 10x10 viewBox, 1px stroke,
 * matching the JetBrains "thin line" style.
 * ----------------------------------------------------------------*/

function MinimizeIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M2 5h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      {/* Back window (offset up-right) */}
      <path
        d="M3.5 1.5h4a1 1 0 0 1 1 1v4"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Front window */}
      <rect x="1.5" y="3.5" width="5" height="5" rx="0.75" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------
 * Shared base classes for the control buttons.
 *
 * Buttons stretch to the full height of the 52px header via
 * `self-stretch` + parent `items-stretch`.  Width is 44px (w-11),
 * no border-radius — matching the JetBrains / PyCharm titlebar
 * control style.  Close button uses a solid red (#e81123) on hover.
 * ----------------------------------------------------------------*/

const baseButtonClasses =
  "inline-flex items-center justify-center w-11 self-stretch text-muted-foreground/70 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function WindowControls({
  isMaximized,
  onMinimize,
  onMaximize,
  onClose,
}: WindowControlsProps) {
  return (
    <div
      className="flex items-stretch"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* Minimize */}
      <button
        type="button"
        aria-label="Minimize"
        className={`${baseButtonClasses} hover:bg-white/10 hover:text-foreground`}
        onClick={onMinimize}
      >
        <MinimizeIcon />
      </button>

      {/* Maximize / Restore */}
      <button
        type="button"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        className={`${baseButtonClasses} hover:bg-white/10 hover:text-foreground`}
        onClick={onMaximize}
      >
        {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>

      {/* Close */}
      <button
        type="button"
        aria-label="Close"
        className={`${baseButtonClasses} hover:bg-[#e81123] hover:text-white`}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
