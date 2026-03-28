/**
 * Hook that manages custom window controls for frameless windows.
 *
 * On macOS the native traffic-light buttons handle minimize / maximize / close,
 * so this hook reports `showControls: false`.  On Windows and Linux the app
 * uses `frame: false`, so this hook provides the callbacks and reactive
 * `isMaximized` state needed by the `WindowControlsOverlay` component.
 */

import { useState, useEffect, useCallback } from "react";
import { isMacPlatform } from "~/lib/utils";

interface WindowControlsState {
  /** Whether custom window controls should be rendered. */
  showControls: boolean;
  /** Whether the window is currently maximized. */
  isMaximized: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

export function useWindowControls(): WindowControlsState {
  const showControls = !isMacPlatform(navigator.platform);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!showControls) return;

    // Seed with the current state.
    void window.desktopBridge?.getWindowIsMaximized?.()?.then(setIsMaximized);

    // Subscribe to future maximize / unmaximize events.
    const unsub = window.desktopBridge?.onWindowMaximizedChange?.((maximized) => {
      setIsMaximized(maximized);
    });

    return () => {
      unsub?.();
    };
  }, [showControls]);

  const minimize = useCallback(() => {
    void window.desktopBridge?.windowMinimize?.();
  }, []);

  const maximize = useCallback(() => {
    void window.desktopBridge?.windowMaximize?.();
  }, []);

  const close = useCallback(() => {
    void window.desktopBridge?.windowClose?.();
  }, []);

  return { showControls, isMaximized, minimize, maximize, close };
}
