import { promises as fs } from "node:fs";
import type { AudioCapture } from "../audio/audio-capture.js";
import type { AudioChunk } from "../audio/capture-types.js";
import { createTempFilePath } from "../common/fs.js";
import { CaptureError } from "../common/errors.js";
import type { SpeechTranscriber } from "../speech/speech-transcriber.js";
import type { TranscriptionResult } from "../speech/whisper-types.js";
import type { TextInserter } from "../text/text-inserter.js";
import type { DictationSessionLike, DictationSessionOptions } from "./dictation-types.js";

interface ConstructorOptions {
  capture: AudioCapture;
  transcriber: SpeechTranscriber;
  textInserter?: TextInserter;
  options: DictationSessionOptions;
}

export class DictationSession implements DictationSessionLike {
  private readonly capture: AudioCapture;
  private readonly transcriber: SpeechTranscriber;
  private readonly textInserter?: TextInserter;
  private readonly options: DictationSessionOptions;
  private readonly partialListeners = new Set<(chunk: AudioChunk) => void>();
  private captureUnsubscribe: (() => void) | null = null;
  private internalWavPath: string | null = null;
  private started = false;

  constructor(options: ConstructorOptions) {
    this.capture = options.capture;
    this.transcriber = options.transcriber;
    this.textInserter = options.textInserter;
    this.options = options.options;
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new CaptureError("Dictation session already started");
    }

    const captureOptions = { ...this.options.capture };
    if (!captureOptions.output?.wavPath) {
      this.internalWavPath = await createTempFilePath("desktop-stt-session", ".wav");
      captureOptions.output = {
        ...captureOptions.output,
        wavPath: this.internalWavPath,
      };
    }

    this.captureUnsubscribe = this.capture.onChunk((chunk) => {
      for (const listener of this.partialListeners) {
        listener(chunk);
      }
    });

    await this.capture.start(captureOptions);
    this.started = true;
  }

  async stop(): Promise<TranscriptionResult> {
    if (!this.started) {
      throw new CaptureError("Dictation session is not started");
    }

    const stopped = await this.capture.stop();
    this.started = false;
    this.captureUnsubscribe?.();
    this.captureUnsubscribe = null;

    if (!stopped.wavPath) {
      throw new CaptureError("No WAV output path was produced by the capture layer");
    }

    const result = await this.transcriber.transcribeWav(stopped.wavPath, this.options.transcription);

    if ((this.options.autoInsert ?? true) && this.textInserter) {
      await this.textInserter.insert(result.text, this.options.insertion);
    }

    await this.cleanupInternalWav(stopped.wavPath);
    return result;
  }

  async cancel(): Promise<void> {
    if (!this.started) {
      return;
    }

    const stopped = await this.capture.stop();
    this.started = false;
    this.captureUnsubscribe?.();
    this.captureUnsubscribe = null;

    if (stopped.wavPath) {
      await this.cleanupInternalWav(stopped.wavPath);
    }
  }

  onPartialAudio(listener: (chunk: AudioChunk) => void): () => void {
    this.partialListeners.add(listener);
    return () => this.partialListeners.delete(listener);
  }

  private async cleanupInternalWav(wavPath: string): Promise<void> {
    if (this.internalWavPath && wavPath === this.internalWavPath) {
      try {
        await fs.unlink(wavPath);
      } catch {
        // best-effort cleanup
      } finally {
        this.internalWavPath = null;
      }
    }
  }
}
