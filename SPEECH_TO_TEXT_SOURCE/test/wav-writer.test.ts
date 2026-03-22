import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WavWriter } from "../src/audio/wav-writer.js";

describe("WavWriter", () => {
  it("writes a valid header and payload length", async () => {
    const filePath = path.join(tmpdir(), `wav-writer-${Date.now()}.wav`);
    const writer = new WavWriter(filePath, 16000, 1, 16);
    const payload = Buffer.from([1, 2, 3, 4, 5, 6]);
    await writer.write(payload);
    await writer.close();

    const data = await fs.readFile(filePath);
    expect(data.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(data.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(data.readUInt32LE(40)).toBe(payload.length);
    expect(data.subarray(44).length).toBe(payload.length);

    await fs.unlink(filePath);
  });
});
