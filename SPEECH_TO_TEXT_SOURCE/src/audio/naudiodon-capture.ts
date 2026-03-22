import path from "node:path";
import { createWriteStream, type WriteStream } from "node:fs";
import { performance } from "node:perf_hooks";
import * as naudiodon from "naudiodon";
import { ensureDir } from "../common/fs.js";
import { CaptureError, DependencyError } from "../common/errors.js";
import type { AudioCapture } from "./audio-capture.js";
import type { AudioChunk, AudioDeviceInfo, CaptureStopResult, StartCaptureOptions } from "./capture-types.js";
import { WavWriter } from "./wav-writer.js";

export class NaudiodonAudioCapture implements AudioCapture {
  private inputStream: naudiodon.AudioIO | null = null;
  private wavWriter: WavWriter | null = null;
  private rawWriter: WriteStream | null = null;
  private chunkListeners = new Set<(chunk: AudioChunk) => void>();
  private errorListeners = new Set<(error: Error) => void>();
  private capturing = false;
  private startedAt = 0;
  private output: StartCaptureOptions["output"] = undefined;

  async listInputDevices(): Promise<AudioDeviceInfo[]> {
    const devices = naudiodon.getDevices().filter((device) => (device.maxInputChannels ?? 0) > 0);
    return devices.map((device, index) => ({
      id: String(device.id),
      name: device.name,
      defaultSampleRate: device.defaultSampleRate,
      inputChannels: device.maxInputChannels,
      hostApi: device.hostAPIName,
      isDefault: index === 0,
    }));
  }

  async start(options: StartCaptureOptions): Promise<void> {
    if (this.capturing) {
      throw new CaptureError("Audio capture is already running");
    }

    if (options.sampleRate !== 16000 || options.channels !== 1 || options.bitDepth !== 16) {
      throw new DependencyError("Only 16 kHz, mono, 16-bit capture is supported in v1");
    }

    const devices = await this.listInputDevices();
    if (options.deviceId && !devices.some((device) => device.id === options.deviceId)) {
      throw new CaptureError(`Audio input device not found: ${options.deviceId}`);
    }

    this.output = options.output;
    if (options.output?.wavPath) {
      await ensureDir(path.dirname(options.output.wavPath));
      this.wavWriter = new WavWriter(options.output.wavPath, options.sampleRate, options.channels, options.bitDepth);
    }

    if (options.output?.rawPath) {
      await ensureDir(path.dirname(options.output.rawPath));
      this.rawWriter = createWriteStream(options.output.rawPath);
    }

    const inOptions: ConstructorParameters<typeof naudiodon.AudioIO>[0]["inOptions"] = {
      channelCount: options.channels,
      sampleFormat: naudiodon.SampleFormat16Bit,
      sampleRate: options.sampleRate,
      closeOnError: true,
    };

    if (options.deviceId) {
      inOptions.deviceId = Number(options.deviceId);
    }

    this.inputStream = new naudiodon.AudioIO({ inOptions });
    this.startedAt = performance.now();

    this.inputStream.on("data", async (pcm: Buffer) => {
      try {
        const chunk: AudioChunk = {
          pcm,
          timestampMs: performance.now() - this.startedAt,
        };

        if (this.rawWriter) {
          this.rawWriter.write(pcm);
        }
        if (this.wavWriter) {
          await this.wavWriter.write(pcm);
        }
        for (const listener of this.chunkListeners) {
          listener(chunk);
        }
      } catch (error) {
        this.emitError(new CaptureError("Failed while processing incoming audio", { cause: error }));
      }
    });

    this.inputStream.on("error", (error: Error) => {
      this.emitError(new CaptureError("Audio input stream failed", { cause: error }));
    });

    try {
      this.inputStream.start();
      this.capturing = true;
    } catch (error) {
      throw new CaptureError("Failed to start audio input stream", { cause: error });
    }
  }

  async stop(): Promise<CaptureStopResult> {
    if (!this.capturing) {
      return {
        wavPath: this.output?.wavPath,
        rawPath: this.output?.rawPath,
        durationMs: 0,
      };
    }

    this.capturing = false;
    this.inputStream?.quit();
    this.inputStream = null;

    if (this.rawWriter) {
      await new Promise<void>((resolve, reject) => {
        const stream = this.rawWriter!;
        stream.on("error", reject);
        stream.end(() => resolve());
      });
      this.rawWriter = null;
    }

    if (this.wavWriter) {
      await this.wavWriter.close();
      this.wavWriter = null;
    }

    return {
      wavPath: this.output?.wavPath,
      rawPath: this.output?.rawPath,
      durationMs: performance.now() - this.startedAt,
    };
  }

  onChunk(listener: (chunk: AudioChunk) => void): () => void {
    this.chunkListeners.add(listener);
    return () => this.chunkListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}
