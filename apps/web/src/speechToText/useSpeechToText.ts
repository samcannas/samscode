import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readNativeApi } from "~/nativeApi";
import type { SpeechToTextAudioChunk } from "@samscode/contracts";

import { BrowserSpeechRecorder, MAX_SPEECH_TO_TEXT_RECORDING_MS } from "./audioCapture";
import { useSpeechToTextState } from "./speechToTextState";

const APPEND_BATCH_INTERVAL_MS = 320;

export interface SpeechToTextComposerSnapshot {
  readonly value: string;
  readonly cursor: number;
  readonly expandedCursor: number;
  readonly terminalContextIds: string[];
}

export interface UseSpeechToTextOptions {
  readonly canUseComposer: boolean;
  readonly readComposerSnapshot: () => SpeechToTextComposerSnapshot | null;
  readonly insertTranscript: (
    transcript: string,
    snapshot: SpeechToTextComposerSnapshot,
  ) => void | Promise<void>;
  readonly replaceTranscript?: (
    nextTranscript: string,
    previousTranscript: string,
    snapshot: SpeechToTextComposerSnapshot,
  ) => void | Promise<void>;
  readonly isTerminalFocused: () => boolean;
  readonly isModalOpen: () => boolean;
}

export type SpeechToTextButtonState =
  | "idle"
  | "recording"
  | "transcribing"
  | "unavailable"
  | "error";

function normalizeTranscriptionError(error: unknown): string {
  return error instanceof Error ? error.message : "Speech-to-text failed.";
}

function logSpeechToTextError(context: string, error: unknown): void {
  console.error(`[speech-to-text] ${context}`, error);
}

async function waitForPendingAppends(pendingAppends: ReadonlyArray<Promise<void>>): Promise<void> {
  await Promise.race([
    Promise.allSettled(pendingAppends).then(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 2_000);
    }),
  ]);
}

function flushableErrorMessage(error: unknown): string {
  return normalizeTranscriptionError(error);
}

function canStartRecording(options: {
  readonly canUseComposer: boolean;
  readonly state: ReturnType<typeof useSpeechToTextState>["state"];
  readonly isTerminalFocused: () => boolean;
  readonly isModalOpen: () => boolean;
}): boolean {
  if (!options.canUseComposer || options.isTerminalFocused() || options.isModalOpen()) {
    return false;
  }
  const serverState = options.state;
  if (!serverState) {
    return false;
  }
  return (
    serverState.available &&
    serverState.runtimeStatus === "ready" &&
    serverState.selectedModelId !== null &&
    serverState.installedModels.length > 0
  );
}

function joinTranscriptPreview(
  committedSegments: ReadonlyArray<string>,
  partialText: string,
): string {
  return [...committedSegments, partialText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function useSpeechToText(options: UseSpeechToTextOptions) {
  const { state: speechToTextState } = useSpeechToTextState();
  const optionsRef = useRef(options);
  const recorderRef = useRef<BrowserSpeechRecorder | null>(null);
  const transcribeSnapshotRef = useRef<SpeechToTextComposerSnapshot | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const inFlightBatchPromisesRef = useRef<Set<Promise<void>>>(new Set());
  const pendingBatchRef = useRef<SpeechToTextAudioChunk[]>([]);
  const batchFlushTimerRef = useRef<number | null>(null);
  const insertedTranscriptRef = useRef<string | null>(null);
  const committedSegmentsRef = useRef<string[]>([]);
  const finalInsertedRef = useRef(false);
  const holdShortcutActiveRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const stopTimerRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string>("");

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const clearBatchFlushTimer = useCallback(() => {
    if (batchFlushTimerRef.current !== null) {
      window.clearTimeout(batchFlushTimerRef.current);
      batchFlushTimerRef.current = null;
    }
  }, []);

  const resetSessionState = useCallback(() => {
    recorderRef.current = null;
    sessionIdRef.current = null;
    inFlightBatchPromisesRef.current = new Set();
    pendingBatchRef.current = [];
    clearBatchFlushTimer();
    insertedTranscriptRef.current = null;
    committedSegmentsRef.current = [];
    transcribeSnapshotRef.current = null;
    finalInsertedRef.current = false;
    stopInFlightRef.current = false;
    setPreviewText("");
    setPhase("idle");
    holdShortcutActiveRef.current = false;
  }, [clearBatchFlushTimer]);

  const cancelRecording = useCallback(async () => {
    clearStopTimer();
    clearBatchFlushTimer();
    const api = readNativeApi();
    const sessionId = sessionIdRef.current;
    const recorder = recorderRef.current;
    resetSessionState();
    await recorder?.cancel().catch(() => undefined);
    if (api && sessionId) {
      await api.speechToText.cancelSession({ sessionId }).catch(() => undefined);
    }
  }, [clearBatchFlushTimer, clearStopTimer, resetSessionState]);

  const flushPendingBatch = useCallback(async () => {
    clearBatchFlushTimer();
    const api = readNativeApi();
    const sessionId = sessionIdRef.current;
    const batch = pendingBatchRef.current;
    if (!api || !sessionId || batch.length === 0) {
      pendingBatchRef.current = [];
      return;
    }

    pendingBatchRef.current = [];
    const appendPromise = api.speechToText
      .appendAudioBatch({
        sessionId,
        chunks: batch as [SpeechToTextAudioChunk, ...SpeechToTextAudioChunk[]],
      })
      .catch((error) => {
        logSpeechToTextError("append audio batch failed", error);
        setErrorMessage(flushableErrorMessage(error));
      })
      .finally(() => {
        inFlightBatchPromisesRef.current.delete(appendPromise);
      });
    inFlightBatchPromisesRef.current.add(appendPromise);
    await appendPromise;
  }, [clearBatchFlushTimer]);

  const queueChunkForAppend = useCallback(
    (chunk: SpeechToTextAudioChunk) => {
      pendingBatchRef.current = [...pendingBatchRef.current, chunk];
      if (pendingBatchRef.current.length >= 4) {
        void flushPendingBatch();
        return;
      }
      if (batchFlushTimerRef.current !== null) {
        return;
      }
      batchFlushTimerRef.current = window.setTimeout(() => {
        batchFlushTimerRef.current = null;
        void flushPendingBatch();
      }, APPEND_BATCH_INTERVAL_MS);
    },
    [flushPendingBatch],
  );

  const stopRecordingAndTranscribe = useCallback(async () => {
    if (stopInFlightRef.current) {
      return;
    }
    stopInFlightRef.current = true;
    clearStopTimer();
    const api = readNativeApi();
    const sessionId = sessionIdRef.current;
    const recorder = recorderRef.current;
    if (!api || !sessionId || !recorder) {
      resetSessionState();
      return;
    }

    const latestSnapshot =
      optionsRef.current.readComposerSnapshot() ?? transcribeSnapshotRef.current;
    if (!latestSnapshot) {
      await cancelRecording();
      setErrorMessage("The composer selection was lost before inserting the transcript.");
      return;
    }
    transcribeSnapshotRef.current = latestSnapshot;

    setPhase("transcribing");
    try {
      await recorder.stop();
      await flushPendingBatch();
      await waitForPendingAppends([...inFlightBatchPromisesRef.current]);
      await api.speechToText.stopSession({ sessionId });
    } catch (error) {
      logSpeechToTextError("stop failed", error);
      setErrorMessage(normalizeTranscriptionError(error));
      await cancelRecording();
    } finally {
      stopInFlightRef.current = false;
    }
  }, [cancelRecording, clearStopTimer, flushPendingBatch, resetSessionState]);

  const startRecording = useCallback(async () => {
    if (phase !== "idle") {
      return;
    }
    if (
      !canStartRecording({
        canUseComposer: options.canUseComposer,
        state: speechToTextState,
        isTerminalFocused: options.isTerminalFocused,
        isModalOpen: options.isModalOpen,
      })
    ) {
      return;
    }

    const snapshot = options.readComposerSnapshot();
    if (!snapshot) {
      setErrorMessage("Open a chat composer before recording speech-to-text.");
      return;
    }

    const api = readNativeApi();
    if (!api) {
      setErrorMessage("Speech-to-text API is unavailable.");
      return;
    }

    try {
      const session = await api.speechToText.startSession();
      const recorder = new BrowserSpeechRecorder();
      sessionIdRef.current = session.sessionId;
      recorderRef.current = recorder;
      transcribeSnapshotRef.current = snapshot;
      insertedTranscriptRef.current = null;
      committedSegmentsRef.current = [];
      inFlightBatchPromisesRef.current = new Set();
      pendingBatchRef.current = [];
      clearBatchFlushTimer();
      finalInsertedRef.current = false;
      setPreviewText("");
      setErrorMessage(null);
      setPhase("recording");
      await recorder.start({
        onChunk: (chunk) => {
          if (!sessionIdRef.current) {
            return;
          }
          queueChunkForAppend(chunk);
        },
      });
      stopTimerRef.current = window.setTimeout(() => {
        void stopRecordingAndTranscribe();
      }, MAX_SPEECH_TO_TEXT_RECORDING_MS);
    } catch (error) {
      logSpeechToTextError("start failed", error);
      resetSessionState();
      setErrorMessage(normalizeTranscriptionError(error));
    }
  }, [
    clearBatchFlushTimer,
    options,
    phase,
    queueChunkForAppend,
    resetSessionState,
    speechToTextState,
    stopRecordingAndTranscribe,
  ]);

  useEffect(() => {
    const api = readNativeApi();
    if (!api) {
      return undefined;
    }

    return api.speechToText.onSessionEvent((event) => {
      if (event.sessionId !== sessionIdRef.current) {
        return;
      }

      if (event.type === "partial") {
        setPreviewText(joinTranscriptPreview(committedSegmentsRef.current, event.text));
        return;
      }

      if (event.type === "segmentCommitted") {
        committedSegmentsRef.current = [...committedSegmentsRef.current, event.text];
        setPreviewText(joinTranscriptPreview(committedSegmentsRef.current, ""));
        return;
      }

      if (event.type === "error") {
        setErrorMessage(event.message);
        logSpeechToTextError("session error event", event.message);
        void cancelRecording();
        return;
      }

      if (event.type === "final") {
        setPreviewText(event.text);
        const latestSnapshot =
          transcribeSnapshotRef.current ?? optionsRef.current.readComposerSnapshot();
        if (!latestSnapshot) {
          setErrorMessage("The composer selection was lost before inserting the transcript.");
          return;
        }

        const previousTranscript = insertedTranscriptRef.current;
        const insertOrReplace =
          (event.stage === "refined" || event.stage === "single") &&
          previousTranscript &&
          previousTranscript !== event.text &&
          optionsRef.current.replaceTranscript
            ? optionsRef.current.replaceTranscript(event.text, previousTranscript, latestSnapshot)
            : !finalInsertedRef.current || event.stage === "draft"
              ? optionsRef.current.insertTranscript(event.text, latestSnapshot)
              : Promise.resolve();

        void Promise.resolve(insertOrReplace)
          .then(() => {
            insertedTranscriptRef.current = event.text;
            finalInsertedRef.current = true;
            setErrorMessage(null);
          })
          .catch((error) => {
            logSpeechToTextError("insert transcript failed", error);
            setErrorMessage(normalizeTranscriptionError(error));
          });
        return;
      }

      if (event.type === "ended") {
        clearStopTimer();
        resetSessionState();
      }
    });
  }, [cancelRecording, clearStopTimer, resetSessionState]);

  useEffect(() => {
    const handleWindowBlur = () => {
      if (phase === "recording") {
        void cancelRecording();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" && phase === "recording") {
        void cancelRecording();
      }
    };
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [cancelRecording, phase]);

  useEffect(() => {
    return () => {
      void cancelRecording();
    };
  }, [cancelRecording]);

  const buttonState = useMemo<SpeechToTextButtonState>(() => {
    if (phase === "recording") return "recording";
    if (phase === "transcribing") return "transcribing";
    if (errorMessage) return "error";
    if (
      !canStartRecording({
        canUseComposer: options.canUseComposer,
        state: speechToTextState,
        isTerminalFocused: options.isTerminalFocused,
        isModalOpen: options.isModalOpen,
      })
    ) {
      return "unavailable";
    }
    return "idle";
  }, [errorMessage, options, phase, speechToTextState]);

  const onMicButtonClick = useCallback(async () => {
    if (phase === "recording") {
      await stopRecordingAndTranscribe();
      return;
    }
    holdShortcutActiveRef.current = false;
    await startRecording();
  }, [phase, startRecording, stopRecordingAndTranscribe]);

  const onShortcutKeyDown = useCallback(async () => {
    if (holdShortcutActiveRef.current || phase !== "idle") {
      return;
    }
    holdShortcutActiveRef.current = true;
    await startRecording();
  }, [phase, startRecording]);

  const onShortcutKeyUp = useCallback(async () => {
    if (!holdShortcutActiveRef.current) {
      return;
    }
    holdShortcutActiveRef.current = false;
    if (phase === "recording") {
      await stopRecordingAndTranscribe();
    }
  }, [phase, stopRecordingAndTranscribe]);

  return {
    serverState: speechToTextState,
    buttonState,
    errorMessage,
    previewText,
    isTranscribing: phase === "transcribing",
    onMicButtonClick,
    onShortcutKeyDown,
    onShortcutKeyUp,
    clearError: () => setErrorMessage(null),
  };
}
