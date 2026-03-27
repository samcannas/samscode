import { arrayBufferToBase64, encodeMonoPcm16, resampleMonoPcmLinear } from "./wavEncoder";

const TARGET_SAMPLE_RATE = 16_000;
const CAPTURE_WORKLET_NAME = "samscode-pcm-capture";
const CAPTURE_WORKLET_URL = new URL("./pcmCaptureProcessor.worklet.js", import.meta.url);
const AUDIO_CONTEXT_CLOSE_TIMEOUT_MS = 1_000;
const STREAM_CHUNK_MS = 120;

export const MAX_SPEECH_TO_TEXT_RECORDING_MS = 90_000;

export interface StreamingSpeechChunk {
  readonly sequence: number;
  readonly pcmBase64: string;
  readonly durationMs: number;
}

function normalizeAudioCaptureError(error: unknown): Error {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return new Error("Microphone access was denied. Enable it in your system or app settings.");
      case "NotFoundError":
        return new Error("No microphone was found for speech-to-text recording.");
      case "NotReadableError":
        return new Error("The microphone is already in use by another app.");
    }
  }
  return error instanceof Error ? error : new Error("Unable to start microphone recording.");
}

export class BrowserSpeechRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: AudioWorkletNode | null = null;
  private processorMessageListener: ((event: MessageEvent<Float32Array>) => void) | null = null;
  private onChunk: ((chunk: StreamingSpeechChunk) => void) | null = null;
  private pendingSourceChunks: Float32Array[] = [];
  private pendingSourceSamples = 0;
  private startedAt = 0;
  private nextSequence = 0;

  get isRecording(): boolean {
    return this.stream !== null;
  }

  async start(options: { onChunk: (chunk: StreamingSpeechChunk) => void }): Promise<void> {
    if (this.isRecording) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const audioContext = new AudioContext();
      await audioContext.audioWorklet.addModule(CAPTURE_WORKLET_URL.href);
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const processorNode = new AudioWorkletNode(audioContext, CAPTURE_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });

      this.startedAt = performance.now();
      this.nextSequence = 0;
      this.onChunk = options.onChunk;
      this.pendingSourceChunks = [];
      this.pendingSourceSamples = 0;

      const handleChunk = (event: MessageEvent<Float32Array>) => {
        const channelData = event.data;
        this.pendingSourceChunks.push(channelData);
        this.pendingSourceSamples += channelData.length;

        const minimumChunkSamples = Math.max(
          1,
          Math.round((audioContext.sampleRate * STREAM_CHUNK_MS) / 1000),
        );
        if (this.pendingSourceSamples >= minimumChunkSamples) {
          this.flushPendingChunk(audioContext.sampleRate);
        }
      };
      processorNode.port.addEventListener("message", handleChunk);
      processorNode.port.start();

      sourceNode.connect(processorNode);

      this.stream = stream;
      this.audioContext = audioContext;
      this.sourceNode = sourceNode;
      this.processorNode = processorNode;
      this.processorMessageListener = handleChunk;
    } catch (error) {
      throw normalizeAudioCaptureError(error);
    }
  }

  async stop(): Promise<{ durationMs: number }> {
    if (!this.stream || !this.audioContext) {
      throw new Error("No active speech-to-text recording is in progress.");
    }

    const durationMs = Math.max(0, Math.round(performance.now() - this.startedAt));
    this.flushPendingChunk(this.audioContext.sampleRate);
    await this.teardown();
    return { durationMs };
  }

  async cancel(): Promise<void> {
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    this.processorNode?.disconnect();
    if (this.processorNode && this.processorMessageListener) {
      this.processorNode.port.removeEventListener("message", this.processorMessageListener);
    }
    this.sourceNode?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.audioContext && this.audioContext.state !== "closed") {
      await Promise.race([
        this.audioContext.close().catch(() => undefined),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, AUDIO_CONTEXT_CLOSE_TIMEOUT_MS);
        }),
      ]);
    }

    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.processorMessageListener = null;
    this.onChunk = null;
    this.pendingSourceChunks = [];
    this.pendingSourceSamples = 0;
    this.startedAt = 0;
  }

  private flushPendingChunk(sourceSampleRate: number): void {
    const onChunk = this.onChunk;
    if (!onChunk || this.pendingSourceChunks.length === 0) {
      return;
    }

    const totalSamples = this.pendingSourceSamples;
    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of this.pendingSourceChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    this.pendingSourceChunks = [];
    this.pendingSourceSamples = 0;

    const resampled = resampleMonoPcmLinear(merged, sourceSampleRate, TARGET_SAMPLE_RATE);
    if (resampled.length === 0) {
      return;
    }

    const pcm16 = encodeMonoPcm16(resampled);
    const durationMs = Math.max(1, Math.round((resampled.length / TARGET_SAMPLE_RATE) * 1000));
    onChunk({
      sequence: this.nextSequence++,
      pcmBase64: arrayBufferToBase64(pcm16.buffer.slice(0)),
      durationMs,
    });
  }
}
