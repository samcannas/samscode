import { promises as fs } from "node:fs";
import { createWriteStream, type WriteStream } from "node:fs";
import { once } from "node:events";
import { createWavHeader, getWavHeaderSize } from "../common/wav.js";

export class WavWriter {
  private readonly stream: WriteStream;
  private readonly sampleRate: number;
  private readonly channels: number;
  private readonly bitDepth: number;
  private bytesWritten = 0;
  private readonly filePath: string;
  private closed = false;

  constructor(filePath: string, sampleRate: number, channels: number, bitDepth: number) {
    this.filePath = filePath;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bitDepth = bitDepth;
    this.stream = createWriteStream(filePath);
    this.stream.write(createWavHeader(0, sampleRate, channels, bitDepth));
  }

  async write(chunk: Buffer): Promise<void> {
    if (this.closed) {
      throw new Error("Cannot write to a closed WavWriter");
    }

    this.bytesWritten += chunk.length;
    if (!this.stream.write(chunk)) {
      await once(this.stream, "drain");
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    this.stream.end();
    await once(this.stream, "finish");

    const handle = await fs.open(this.filePath, "r+");
    try {
      const header = createWavHeader(this.bytesWritten, this.sampleRate, this.channels, this.bitDepth);
      await handle.write(header, 0, getWavHeaderSize(), 0);
    } finally {
      await handle.close();
    }
  }
}
