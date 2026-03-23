import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readNativeApi } from "~/nativeApi";
import { BrowserSpeechRecorder, MAX_SPEECH_TO_TEXT_RECORDING_MS } from "./audioCapture";
import { useSpeechToTextState } from "./speechToTextState";

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
  const appendTailRef = useRef<Promise<void>>(Promise.resolve());
  const committedSegmentsRef = useRef<string[]>([]);
  const finalInsertedRef = useRef(false);
  const holdShortcutActiveRef = useRef(false);
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

  const resetSessionState = useCallback(() => {
    recorderRef.current = null;
    sessionIdRef.current = null;
    appendTailRef.current = Promise.resolve();
    committedSegmentsRef.current = [];
    transcribeSnapshotRef.current = null;
    finalInsertedRef.current = false;
    setPreviewText("");
    setPhase("idle");
    holdShortcutActiveRef.current = false;
  }, []);

  const cancelRecording = useCallback(async () => {
    clearStopTimer();
    const api = readNativeApi();
    const sessionId = sessionIdRef.current;
    const recorder = recorderRef.current;
    resetSessionState();
    await recorder?.cancel().catch(() => undefined);
    if (api && sessionId) {
      await api.speechToText.cancelSession({ sessionId }).catch(() => undefined);
    }
  }, [clearStopTimer, resetSessionState]);

  const stopRecordingAndTranscribe = useCallback(async () => {
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
      await appendTailRef.current.catch(() => undefined);
      await api.speechToText.stopSession({ sessionId });
    } catch (error) {
      setErrorMessage(normalizeTranscriptionError(error));
      await cancelRecording();
    }
  }, [cancelRecording, clearStopTimer, resetSessionState]);

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
      committedSegmentsRef.current = [];
      appendTailRef.current = Promise.resolve();
      finalInsertedRef.current = false;
      setPreviewText("");
      setErrorMessage(null);
      setPhase("recording");
      await recorder.start({
        onChunk: (chunk) => {
          const currentSessionId = sessionIdRef.current;
          if (!currentSessionId) {
            return;
          }
          appendTailRef.current = appendTailRef.current
            .catch(() => undefined)
            .then(() =>
              api.speechToText.appendAudio({
                sessionId: currentSessionId,
                sequence: chunk.sequence,
                pcmBase64: chunk.pcmBase64,
                durationMs: chunk.durationMs,
              }),
            );
        },
      });
      stopTimerRef.current = window.setTimeout(() => {
        void stopRecordingAndTranscribe();
      }, MAX_SPEECH_TO_TEXT_RECORDING_MS);
    } catch (error) {
      resetSessionState();
      setErrorMessage(normalizeTranscriptionError(error));
    }
  }, [options, phase, resetSessionState, speechToTextState, stopRecordingAndTranscribe]);

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
        return;
      }

      if (event.type === "final") {
        setPreviewText(event.text);
        if (finalInsertedRef.current) {
          return;
        }
        finalInsertedRef.current = true;
        const latestSnapshot =
          optionsRef.current.readComposerSnapshot() ?? transcribeSnapshotRef.current;
        if (!latestSnapshot) {
          setErrorMessage("The composer selection was lost before inserting the transcript.");
          return;
        }

        void Promise.resolve(optionsRef.current.insertTranscript(event.text, latestSnapshot))
          .then(() => {
            setErrorMessage(null);
          })
          .catch((error) => {
            setErrorMessage(normalizeTranscriptionError(error));
          });
        return;
      }

      if (event.type === "ended") {
        clearStopTimer();
        resetSessionState();
      }
    });
  }, [clearStopTimer, resetSessionState]);

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
