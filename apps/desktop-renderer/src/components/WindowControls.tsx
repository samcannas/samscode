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
 * Height is 32px to sit comfortably within the 52px header.  The
 * width is 36px -- just wide enough to feel balanced without
 * becoming a chunky target.  Rounded-sm keeps it refined.
 * ----------------------------------------------------------------*/

const baseButtonClasses =
  "inline-flex items-center justify-center h-8 w-9 rounded-sm text-muted-foreground/70 transition-colors duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function WindowControls({
  isMaximized,
  onMinimize,
  onMaximize,
  onClose,
}: WindowControlsProps) {
  return (
    <div
      className="flex items-center gap-0.5"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* Minimize */}
      <button
        type="button"
        aria-label="Minimize"
        className={`${baseButtonClasses} hover:bg-accent hover:text-foreground`}
        onClick={onMinimize}
      >
        <MinimizeIcon />
      </button>

      {/* Maximize / Restore */}
      <button
        type="button"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        className={`${baseButtonClasses} hover:bg-accent hover:text-foreground`}
        onClick={onMaximize}
      >
        {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>

      {/* Close */}
      <button
        type="button"
        aria-label="Close"
        className={`${baseButtonClasses} hover:bg-red-500/15 hover:text-red-600 dark:hover:bg-red-500/20 dark:hover:text-red-400`}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
