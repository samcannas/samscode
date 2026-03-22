import { type SpeechToTextState } from "@samscode/contracts";
import { useEffect, useSyncExternalStore } from "react";

import { readNativeApi } from "~/nativeApi";

interface SpeechToTextSnapshot {
  readonly loading: boolean;
  readonly state: SpeechToTextState | null;
}

let snapshot: SpeechToTextSnapshot = {
  loading: true,
  state: null,
};

let initialized = false;
let unsubscribeNativeState: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function replaceSnapshot(nextState: SpeechToTextState): void {
  snapshot = {
    loading: false,
    state: nextState,
  };
  emit();
}

function ensureInitialized(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  const api = readNativeApi();
  if (!api) {
    snapshot = {
      loading: false,
      state: null,
    };
    return;
  }

  void api.speechToText
    .getState()
    .then((state) => {
      replaceSnapshot(state);
    })
    .catch(() => {
      snapshot = {
        loading: false,
        state: null,
      };
      emit();
    });

  unsubscribeNativeState = api.speechToText.onStateChanged((state) => {
    replaceSnapshot(state);
  });
}

function subscribe(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeNativeState) {
      unsubscribeNativeState();
      unsubscribeNativeState = null;
      initialized = false;
    }
  };
}

function getSnapshot(): SpeechToTextSnapshot {
  ensureInitialized();
  return snapshot;
}

function getServerSnapshot(): SpeechToTextSnapshot {
  return snapshot;
}

export function updateSpeechToTextState(nextState: SpeechToTextState): void {
  replaceSnapshot(nextState);
}

export function useSpeechToTextState(): SpeechToTextSnapshot {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    ensureInitialized();
  }, []);
  return current;
}
