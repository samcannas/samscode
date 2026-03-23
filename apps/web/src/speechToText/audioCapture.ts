import { arrayBufferToBase64, encodeMonoPcm16, resampleMonoPcmLinear } from "./wavEncoder";

const TARGET_SAMPLE_RATE = 16_000;
const PROCESSOR_BUFFER_SIZE = 2048;

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
        return new Error("Microphone access was denied. Enable it in your browser settings.");
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
  private processorNode: ScriptProcessorNode | null = null;
  private muteNode: GainNode | null = null;
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
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const processorNode = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      const muteNode = audioContext.createGain();
      muteNode.gain.value = 0;

      this.startedAt = performance.now();
      this.nextSequence = 0;

      processorNode.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        const resampled = resampleMonoPcmLinear(
          new Float32Array(channelData),
          audioContext.sampleRate,
          TARGET_SAMPLE_RATE,
        );
        const pcm16 = encodeMonoPcm16(resampled);
        const durationMs = Math.max(1, Math.round((resampled.length / TARGET_SAMPLE_RATE) * 1000));
        options.onChunk({
          sequence: this.nextSequence++,
          pcmBase64: arrayBufferToBase64(pcm16.buffer.slice(0)),
          durationMs,
        });
      };

      sourceNode.connect(processorNode);
      processorNode.connect(muteNode);
      muteNode.connect(audioContext.destination);

      this.stream = stream;
      this.audioContext = audioContext;
      this.sourceNode = sourceNode;
      this.processorNode = processorNode;
      this.muteNode = muteNode;
    } catch (error) {
      throw normalizeAudioCaptureError(error);
    }
  }

  async stop(): Promise<{ durationMs: number }> {
    if (!this.stream || !this.audioContext) {
      throw new Error("No active speech-to-text recording is in progress.");
    }

    const durationMs = Math.max(0, Math.round(performance.now() - this.startedAt));
    await this.teardown();
    return { durationMs };
  }

  async cancel(): Promise<void> {
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.muteNode?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close().catch(() => undefined);
    }

    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.muteNode = null;
    this.startedAt = 0;
  }
}
