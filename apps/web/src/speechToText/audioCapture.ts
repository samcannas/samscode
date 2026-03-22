import { arrayBufferToBase64, encodeMonoWav, resampleMonoPcmLinear } from "./wavEncoder";

const TARGET_SAMPLE_RATE = 16_000;
export const MAX_SPEECH_TO_TEXT_RECORDING_MS = 90_000;

export interface CapturedSpeechAudio {
  readonly wavBase64: string;
  readonly durationMs: number;
  readonly fileName: string;
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

function concatAudioChunks(chunks: ReadonlyArray<Float32Array>): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export class BrowserSpeechRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private muteNode: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;

  get isRecording(): boolean {
    return this.stream !== null;
  }

  async start(): Promise<void> {
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
      const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      const muteNode = audioContext.createGain();
      muteNode.gain.value = 0;

      this.chunks = [];
      this.startedAt = performance.now();
      processorNode.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        this.chunks.push(new Float32Array(channelData));
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

  async stop(): Promise<CapturedSpeechAudio> {
    if (!this.stream || !this.audioContext) {
      throw new Error("No active speech-to-text recording is in progress.");
    }

    const audioContext = this.audioContext;
    const chunks = concatAudioChunks(this.chunks);
    const resampled = resampleMonoPcmLinear(chunks, audioContext.sampleRate, TARGET_SAMPLE_RATE);
    const wavBuffer = encodeMonoWav(resampled, TARGET_SAMPLE_RATE);
    const durationMs = Math.max(0, Math.round(performance.now() - this.startedAt));
    await this.teardown();

    return {
      wavBase64: arrayBufferToBase64(wavBuffer),
      durationMs,
      fileName: "speech-to-text.wav",
    };
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
    this.chunks = [];
    this.startedAt = 0;
  }
}
