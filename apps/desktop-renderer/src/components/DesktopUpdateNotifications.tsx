import {
  ArrowDownToLineIcon,
  DownloadIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useDesktopUpdateState } from "~/hooks/useDesktopUpdateState";
import { cn } from "~/lib/utils";
import {
  formatDesktopUpdateByteSize,
  getDesktopUpdateReleaseNotesSnippet,
  getDesktopUpdateVersion,
  resolveDesktopUpdatePromptKind,
} from "./desktopUpdate.logic";
import { Button } from "./ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { toastManager } from "./ui/toast";

export function DesktopUpdateNotifications() {
  const { state, downloadUpdate, installUpdate } = useDesktopUpdateState();
  const [dismissedAvailableVersion, setDismissedAvailableVersion] = useState<string | null>(null);
  const [dismissedInstallVersion, setDismissedInstallVersion] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<"download" | "install" | null>(null);

  const promptKind = resolveDesktopUpdatePromptKind(state);
  const version = getDesktopUpdateVersion(state);
  const sizeLabel = formatDesktopUpdateByteSize(state?.availableSizeBytes ?? null);
  const releaseNotesSnippet = getDesktopUpdateReleaseNotesSnippet(state, 180);
  const hidden =
    !state ||
    !promptKind ||
    (promptKind === "available" && state.availableVersion === dismissedAvailableVersion) ||
    (promptKind === "install" && version !== null && version === dismissedInstallVersion);

  const copy = useMemo(() => {
    switch (promptKind) {
      case "available": {
        const hasDownloadError = state?.errorContext === "download" && Boolean(state.message);
        return {
          icon: DownloadIcon,
          iconClassName: hasDownloadError ? "text-rose-500" : "text-amber-500",
          title: hasDownloadError ? "Update download failed" : "Update available",
          description: hasDownloadError
            ? `Sam's Code ${version ?? "update"} is still ready to download${sizeLabel ? ` (${sizeLabel})` : ""}.`
            : `Sam's Code ${version ?? "update"} is ready to download${sizeLabel ? ` (${sizeLabel})` : ""}.`,
          actionLabel: hasDownloadError ? "Retry download" : "Download",
          showDismiss: true,
        };
      }
      case "downloading": {
        const progress =
          typeof state?.downloadPercent === "number"
            ? `${Math.floor(state.downloadPercent)}%`
            : null;
        return {
          icon: LoaderCircleIcon,
          iconClassName: "animate-spin text-sky-500",
          title: "Downloading update",
          description: `Downloading Sam's Code ${version ?? "update"}${progress ? ` (${progress})` : ""}${sizeLabel ? ` of ${sizeLabel}` : ""}.`,
          actionLabel: null,
          showDismiss: false,
        };
      }
      case "install": {
        const hasInstallError = state?.errorContext === "install" && Boolean(state.message);
        return {
          icon: ArrowDownToLineIcon,
          iconClassName: hasInstallError ? "text-rose-500" : "text-emerald-500",
          title: hasInstallError ? "Update install failed" : "Update ready to install",
          description: hasInstallError
            ? `Sam's Code ${version ?? "update"} is still downloaded and ready to install again.`
            : `Sam's Code ${version ?? "update"} has been downloaded and is ready to install.`,
          actionLabel: hasInstallError ? "Install again" : "Install now",
          showDismiss: true,
        };
      }
      case "verifying":
        return {
          icon: RefreshCwIcon,
          iconClassName: "animate-spin text-sky-500",
          title: "Verifying downloaded update",
          description: `Checking the cached Sam's Code ${version ?? "update"} installer from your previous session.`,
          actionLabel: null,
          showDismiss: false,
        };
      default:
        return null;
    }
  }, [promptKind, sizeLabel, state?.downloadPercent, state?.errorContext, state?.message, version]);

  const handleDismiss = useCallback(() => {
    if (!state || !version) return;
    if (promptKind === "available") {
      setDismissedAvailableVersion(state.availableVersion);
      return;
    }
    if (promptKind === "install") {
      setDismissedInstallVersion(version);
    }
  }, [promptKind, state, version]);

  const handleDownload = useCallback(async () => {
    setActionInFlight("download");
    try {
      const result = await downloadUpdate();
      if (result && result.accepted && !result.completed && result.state.message) {
        toastManager.add({
          type: "error",
          title: "Could not download update",
          description: result.state.message,
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not download update",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    } finally {
      setActionInFlight(null);
    }
  }, [downloadUpdate]);

  const handleInstall = useCallback(async () => {
    setActionInFlight("install");
    try {
      const result = await installUpdate();
      if (result && result.accepted && !result.completed && result.state.message) {
        toastManager.add({
          type: "error",
          title: "Could not install update",
          description: result.state.message,
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not install update",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    } finally {
      setActionInFlight(null);
    }
  }, [installUpdate]);

  if (hidden || !copy) {
    return null;
  }

  const Icon = copy.icon;
  const primaryActionDisabled = actionInFlight !== null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 w-[min(26rem,calc(100vw-2rem))] sm:right-6 sm:bottom-6">
      <Card className="pointer-events-auto border-border/80 bg-card/95 shadow-2xl shadow-black/20 backdrop-blur-md">
        <CardHeader className="gap-2 p-4 pr-14">
          <CardAction>
            {copy.showDismiss ? (
              <Button
                aria-label="Dismiss update notification"
                className="-mt-1 -mr-1"
                onClick={handleDismiss}
                size="icon-xs"
                variant="ghost"
              >
                <XIcon />
              </Button>
            ) : null}
          </CardAction>
          <div className="flex items-center gap-2">
            <Icon className={cn("size-4.5", copy.iconClassName)} />
            <CardTitle className="text-sm">{copy.title}</CardTitle>
          </div>
          <CardDescription className="text-sm leading-5">{copy.description}</CardDescription>
          {state.message &&
          (state.errorContext === "download" || state.errorContext === "install") ? (
            <p className="text-xs leading-5 text-destructive">{state.message}</p>
          ) : null}
          {releaseNotesSnippet ? (
            <p className="text-xs leading-5 text-muted-foreground">{releaseNotesSnippet}</p>
          ) : null}
        </CardHeader>
        {promptKind === "available" || promptKind === "install" ? (
          <CardFooter className="justify-start gap-2 pt-0 pb-4">
            <Button
              disabled={primaryActionDisabled}
              onClick={promptKind === "available" ? handleDownload : handleInstall}
              size="sm"
            >
              {copy.actionLabel}
            </Button>
            <Button
              disabled={primaryActionDisabled}
              onClick={handleDismiss}
              size="sm"
              variant="ghost"
            >
              Later
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
