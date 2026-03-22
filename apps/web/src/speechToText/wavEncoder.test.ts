import { describe, expect, it } from "vitest";

import { encodeMonoWav, resampleMonoPcmLinear } from "./wavEncoder";

describe("speechToText wavEncoder", () => {
  it("resamples mono pcm to the target sample rate", () => {
    const input = new Float32Array(48_000).fill(0.25);
    const output = resampleMonoPcmLinear(input, 48_000, 16_000);
    expect(output.length).toBe(16_000);
    expect(output[0]).toBeCloseTo(0.25, 3);
  });

  it("encodes a wav header for mono pcm", () => {
    const wav = encodeMonoWav(new Float32Array([0, 0.5, -0.5]), 16_000);
    const view = new DataView(wav);
    const tag = (offset: number) =>
      String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
      );

    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(36)).toBe("data");
  });
});
