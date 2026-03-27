import { describe, expect, it } from "vitest";

import { encodeMonoPcm16, resampleMonoPcmLinear } from "./wavEncoder";

describe("speechToText wavEncoder", () => {
  it("resamples mono pcm to the target sample rate", () => {
    const input = new Float32Array(48_000).fill(0.25);
    const output = resampleMonoPcmLinear(input, 48_000, 16_000);
    expect(output.length).toBe(16_000);
    expect(output[0]).toBeCloseTo(0.25, 3);
  });

  it("encodes mono PCM16 data", () => {
    const pcm = encodeMonoPcm16(new Float32Array([0, 0.5, -0.5]));
    const view = new DataView(pcm.buffer);

    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBeGreaterThan(0);
    expect(view.getInt16(4, true)).toBeLessThan(0);
  });
});
