import { promises as fs } from "node:fs";

const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BIT_DEPTH = 16;
const BYTES_PER_SAMPLE = BIT_DEPTH / 8;

export function decodePcmBase64(pcmBase64: string): Buffer {
  const bytes = Buffer.from(pcmBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new Error("Speech-to-text audio chunk is empty.");
  }
  if (bytes.byteLength % BYTES_PER_SAMPLE !== 0) {
    throw new Error("Speech-to-text audio chunk does not contain aligned PCM16 samples.");
  }
  return bytes;
}

export function concatPcmChunks(chunks: ReadonlyArray<Buffer>): Buffer {
  return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
}

export function calculateChunkRms(pcmChunk: Buffer): number {
  if (pcmChunk.byteLength === 0) {
    return 0;
  }

  let sumSquares = 0;
  const sampleCount = pcmChunk.byteLength / BYTES_PER_SAMPLE;
  for (let offset = 0; offset < pcmChunk.byteLength; offset += BYTES_PER_SAMPLE) {
    const sample = pcmChunk.readInt16LE(offset) / 32768;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

export function createWavHeader(dataLength: number): Buffer {
  const blockAlign = (CHANNELS * BIT_DEPTH) / 8;
  const byteRate = SAMPLE_RATE * blockAlign;
  const buffer = Buffer.alloc(44);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BIT_DEPTH, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

export function createWavBufferFromPcmChunks(chunks: ReadonlyArray<Buffer>): Buffer {
  const pcm = concatPcmChunks(chunks);
  return Buffer.concat([createWavHeader(pcm.byteLength), pcm]);
}

export async function writePcmChunksToWavFile(
  outputPath: string,
  chunks: ReadonlyArray<Buffer>,
): Promise<void> {
  await fs.writeFile(outputPath, createWavBufferFromPcmChunks(chunks));
}
