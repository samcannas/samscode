import {
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  type ContextMenuItem,
  type NativeApi,
  type SpeechToTextSessionEvent,
  type SpeechToTextState,
  ServerConfigUpdatedPayload,
  type UpstreamSyncReviewState,
  WS_CHANNELS,
  WS_METHODS,
  type WsWelcomePayload,
} from "@samscode/contracts";

import { showContextMenuFallback } from "./contextMenuFallback";
import { WsTransport } from "./wsTransport";

let instance: { api: NativeApi; transport: WsTransport } | null = null;
const welcomeListeners = new Set<(payload: WsWelcomePayload) => void>();
const serverConfigUpdatedListeners = new Set<(payload: ServerConfigUpdatedPayload) => void>();
const speechToTextStateListeners = new Set<(payload: SpeechToTextState) => void>();
const speechToTextSessionEventListeners = new Set<(payload: SpeechToTextSessionEvent) => void>();
const upstreamSyncReviewStateListeners = new Set<(payload: UpstreamSyncReviewState) => void>();
const UPSTREAM_SYNC_RELEASE_TIMEOUT_MS = 10 * 60_000;

/**
 * Subscribe to the server welcome message. If a welcome was already received
 * before this call, the listener fires synchronously with the cached payload.
 * This avoids the race between WebSocket connect and React effect registration.
 */
export function onServerWelcome(listener: (payload: WsWelcomePayload) => void): () => void {
  welcomeListeners.add(listener);

  const latestWelcome = instance?.transport.getLatestPush(WS_CHANNELS.serverWelcome)?.data ?? null;
  if (latestWelcome) {
    try {
      listener(latestWelcome);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    welcomeListeners.delete(listener);
  };
}

/**
 * Subscribe to server config update events. Replays the latest update for
 * late subscribers to avoid missing config validation feedback.
 */
export function onServerConfigUpdated(
  listener: (payload: ServerConfigUpdatedPayload) => void,
): () => void {
  serverConfigUpdatedListeners.add(listener);

  const latestConfig =
    instance?.transport.getLatestPush(WS_CHANNELS.serverConfigUpdated)?.data ?? null;
  if (latestConfig) {
    try {
      listener(latestConfig);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    serverConfigUpdatedListeners.delete(listener);
  };
}

export function onSpeechToTextStateChanged(
  listener: (payload: SpeechToTextState) => void,
): () => void {
  speechToTextStateListeners.add(listener);

  const latestState =
    instance?.transport.getLatestPush(WS_CHANNELS.speechToTextUpdated)?.data ?? null;
  if (latestState) {
    try {
      listener(latestState);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    speechToTextStateListeners.delete(listener);
  };
}

export function onSpeechToTextSessionEvent(
  listener: (payload: SpeechToTextSessionEvent) => void,
): () => void {
  speechToTextSessionEventListeners.add(listener);
  return () => {
    speechToTextSessionEventListeners.delete(listener);
  };
}

export function onUpstreamSyncReviewStateChanged(
  listener: (payload: UpstreamSyncReviewState) => void,
): () => void {
  upstreamSyncReviewStateListeners.add(listener);

  const latestState =
    instance?.transport.getLatestPush(WS_CHANNELS.upstreamSyncReviewUpdated)?.data ?? null;
  if (latestState) {
    try {
      listener(latestState);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    upstreamSyncReviewStateListeners.delete(listener);
  };
}

export function createWsNativeApi(): NativeApi {
  if (instance) return instance.api;

  const transport = new WsTransport();

  transport.subscribe(WS_CHANNELS.serverWelcome, (message) => {
    const payload = message.data;
    for (const listener of welcomeListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.serverConfigUpdated, (message) => {
    const payload = message.data;
    for (const listener of serverConfigUpdatedListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.speechToTextUpdated, (message) => {
    const payload = message.data;
    for (const listener of speechToTextStateListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.speechToTextSessionEvent, (message) => {
    const payload = message.data;
    for (const listener of speechToTextSessionEventListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.upstreamSyncReviewUpdated, (message) => {
    const payload = message.data;
    for (const listener of upstreamSyncReviewStateListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });

  const api: NativeApi = {
    dialogs: {
      pickFolder: async () => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder();
      },
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    terminal: {
      open: (input) => transport.request(WS_METHODS.terminalOpen, input),
      write: (input) => transport.request(WS_METHODS.terminalWrite, input),
      resize: (input) => transport.request(WS_METHODS.terminalResize, input),
      clear: (input) => transport.request(WS_METHODS.terminalClear, input),
      restart: (input) => transport.request(WS_METHODS.terminalRestart, input),
      close: (input) => transport.request(WS_METHODS.terminalClose, input),
      onEvent: (callback) =>
        transport.subscribe(WS_CHANNELS.terminalEvent, (message) => callback(message.data)),
    },
    projects: {
      searchEntries: (input) => transport.request(WS_METHODS.projectsSearchEntries, input),
      writeFile: (input) => transport.request(WS_METHODS.projectsWriteFile, input),
    },
    agents: {
      listCatalog: (input) => transport.request(WS_METHODS.agentsListCatalog, input),
      install: (input) => transport.request(WS_METHODS.agentsInstall, input),
      uninstall: (input) => transport.request(WS_METHODS.agentsUninstall, input),
    },
    skills: {
      listCatalog: (input) => transport.request(WS_METHODS.skillsListCatalog, input),
      install: (input) => transport.request(WS_METHODS.skillsInstall, input),
      uninstall: (input) => transport.request(WS_METHODS.skillsUninstall, input),
      buildPrompt: (input) => transport.request(WS_METHODS.skillsBuildPrompt, input),
    },
    shell: {
      openInEditor: (cwd, editor) =>
        transport.request(WS_METHODS.shellOpenInEditor, { cwd, editor }),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        // Some mobile browsers can return null here even when the tab opens.
        // Avoid false negatives and let the browser handle popup policy.
        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    git: {
      pull: (input) => transport.request(WS_METHODS.gitPull, input),
      status: (input) => transport.request(WS_METHODS.gitStatus, input),
      runStackedAction: (input) => transport.request(WS_METHODS.gitRunStackedAction, input),
      listBranches: (input) => transport.request(WS_METHODS.gitListBranches, input),
      createWorktree: (input) => transport.request(WS_METHODS.gitCreateWorktree, input),
      removeWorktree: (input) => transport.request(WS_METHODS.gitRemoveWorktree, input),
      createBranch: (input) => transport.request(WS_METHODS.gitCreateBranch, input),
      checkout: (input) => transport.request(WS_METHODS.gitCheckout, input),
      init: (input) => transport.request(WS_METHODS.gitInit, input),
      resolvePullRequest: (input) => transport.request(WS_METHODS.gitResolvePullRequest, input),
      preparePullRequestThread: (input) =>
        transport.request(WS_METHODS.gitPreparePullRequestThread, input),
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>;
        }
        return showContextMenuFallback(items, position);
      },
    },
    server: {
      getConfig: () => transport.request(WS_METHODS.serverGetConfig),
      upsertKeybinding: (input) => transport.request(WS_METHODS.serverUpsertKeybinding, input),
      updateSettings: (input) => transport.request(WS_METHODS.serverUpdateSettings, input),
    },
    speechToText: {
      getState: () => transport.request(WS_METHODS.speechToTextGetState),
      downloadModel: (input) =>
        transport.request(WS_METHODS.speechToTextDownloadModel, input, { timeoutMs: 0 }),
      deleteModel: (input) => transport.request(WS_METHODS.speechToTextDeleteModel, input),
      selectModel: (input) => transport.request(WS_METHODS.speechToTextSelectModel, input),
      updatePreferences: (input) =>
        transport.request(WS_METHODS.speechToTextUpdatePreferences, input),
      startSession: () => transport.request(WS_METHODS.speechToTextStartSession),
      appendAudioBatch: (input) =>
        transport.request(WS_METHODS.speechToTextAppendAudioBatch, input),
      stopSession: (input) => transport.request(WS_METHODS.speechToTextStopSession, input),
      cancelSession: (input) => transport.request(WS_METHODS.speechToTextCancelSession, input),
      onStateChanged: (callback) =>
        transport.subscribe(WS_CHANNELS.speechToTextUpdated, (message) => callback(message.data)),
      onSessionEvent: (callback) =>
        transport.subscribe(WS_CHANNELS.speechToTextSessionEvent, (message) =>
          callback(message.data),
        ),
    },
    orchestration: {
      getSnapshot: () => transport.request(ORCHESTRATION_WS_METHODS.getSnapshot),
      dispatchCommand: (command) =>
        transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command }),
      getTurnDiff: (input) => transport.request(ORCHESTRATION_WS_METHODS.getTurnDiff, input),
      getFullThreadDiff: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.getFullThreadDiff, input),
      replayEvents: (fromSequenceExclusive) =>
        transport.request(ORCHESTRATION_WS_METHODS.replayEvents, { fromSequenceExclusive }),
      onDomainEvent: (callback) =>
        transport.subscribe(ORCHESTRATION_WS_CHANNELS.domainEvent, (message) =>
          callback(message.data),
        ),
    },
    upstreamSync: {
      getStatus: (input) => transport.request(WS_METHODS.upstreamSyncGetStatus, input),
      startNextReleaseReview: (input) =>
        transport.request(WS_METHODS.upstreamSyncStartNextReleaseReview, input),
      getReviewState: (input) => transport.request(WS_METHODS.upstreamSyncGetReviewState, input),
      getRelease: (input) =>
        transport.request(WS_METHODS.upstreamSyncGetRelease, input, {
          timeoutMs: UPSTREAM_SYNC_RELEASE_TIMEOUT_MS,
        }),
      updateCandidate: (input) => transport.request(WS_METHODS.upstreamSyncUpdateCandidate, input),
      generateImplementationPrompt: (input) =>
        transport.request(WS_METHODS.upstreamSyncGenerateImplementationPrompt, input),
      onReviewStateChanged: (callback) =>
        transport.subscribe(
          WS_CHANNELS.upstreamSyncReviewUpdated,
          (message) => callback(message.data),
          { replayLatest: true },
        ),
    },
  };

  instance = { api, transport };
  return api;
}
