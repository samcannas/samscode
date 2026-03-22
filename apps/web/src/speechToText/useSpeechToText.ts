import { type SpeechToTextState } from "@samscode/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readNativeApi } from "~/nativeApi";
import { BrowserSpeechRecorder, MAX_SPEECH_TO_TEXT_RECORDING_MS } from "./audioCapture";
import { updateSpeechToTextState, useSpeechToTextState } from "./speechToTextState";

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
  readonly state: SpeechToTextState | null;
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

export function useSpeechToText(options: UseSpeechToTextOptions) {
  const { state: speechToTextState } = useSpeechToTextState();
  const recorderRef = useRef<BrowserSpeechRecorder | null>(null);
  const transcribeSnapshotRef = useRef<SpeechToTextComposerSnapshot | null>(null);
  const holdShortcutActiveRef = useRef(false);
  const stopTimerRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    clearStopTimer();
    holdShortcutActiveRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setPhase("idle");
    if (!recorder) {
      return;
    }
    await recorder.cancel().catch(() => undefined);
  }, [clearStopTimer]);

  const stopRecordingAndTranscribe = useCallback(async () => {
    clearStopTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) {
      setPhase("idle");
      return;
    }

    const latestSnapshot = options.readComposerSnapshot() ?? transcribeSnapshotRef.current;
    if (!latestSnapshot) {
      await recorder.cancel().catch(() => undefined);
      setPhase("idle");
      setErrorMessage("The composer selection was lost before inserting the transcript.");
      return;
    }
    transcribeSnapshotRef.current = latestSnapshot;

    setPhase("transcribing");
    try {
      const captured = await recorder.stop();
      const api = readNativeApi();
      if (!api) {
        throw new Error("Speech-to-text API is unavailable.");
      }
      const result = await api.speechToText.transcribeWav({
        wavBase64: captured.wavBase64,
        fileName: captured.fileName,
      });
      const nextState = await api.speechToText.getState().catch(() => null);
      if (nextState) {
        updateSpeechToTextState(nextState);
      }
      await options.insertTranscript(result.text, latestSnapshot);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(normalizeTranscriptionError(error));
    } finally {
      holdShortcutActiveRef.current = false;
      transcribeSnapshotRef.current = null;
      setPhase("idle");
    }
  }, [clearStopTimer, options]);

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

    try {
      const recorder = new BrowserSpeechRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      transcribeSnapshotRef.current = snapshot;
      setErrorMessage(null);
      setPhase("recording");
      stopTimerRef.current = window.setTimeout(() => {
        void stopRecordingAndTranscribe();
      }, MAX_SPEECH_TO_TEXT_RECORDING_MS);
    } catch (error) {
      recorderRef.current = null;
      setPhase("idle");
      setErrorMessage(normalizeTranscriptionError(error));
    }
  }, [options, phase, speechToTextState, stopRecordingAndTranscribe]);

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
    isTranscribing: phase === "transcribing",
    onMicButtonClick,
    onShortcutKeyDown,
    onShortcutKeyUp,
    clearError: () => setErrorMessage(null),
  };
}
