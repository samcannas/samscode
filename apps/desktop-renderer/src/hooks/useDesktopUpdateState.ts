import { useCallback, useEffect, useState } from "react";
import type { DesktopUpdateActionResult, DesktopUpdateState } from "@samscode/contracts";

interface UseDesktopUpdateStateResult {
  state: DesktopUpdateState | null;
  checkForUpdates: () => Promise<DesktopUpdateState | null>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult | null>;
  installUpdate: () => Promise<DesktopUpdateActionResult | null>;
}

export function useDesktopUpdateState(): UseDesktopUpdateStateResult {
  const [state, setState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.checkForUpdates !== "function") {
      return null;
    }

    return bridge.checkForUpdates();
  }, []);

  const downloadUpdate = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.downloadUpdate !== "function") {
      return null;
    }

    return bridge.downloadUpdate();
  }, []);

  const installUpdate = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.installUpdate !== "function") {
      return null;
    }

    return bridge.installUpdate();
  }, []);

  return {
    state,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}
