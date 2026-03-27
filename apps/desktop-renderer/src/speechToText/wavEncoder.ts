export function resampleMonoPcmLinear(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (input.length === 0 || sourceSampleRate === targetSampleRate) {
    return input.slice();
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const beforeIndex = Math.floor(sourceIndex);
    const afterIndex = Math.min(input.length - 1, beforeIndex + 1);
    const fraction = sourceIndex - beforeIndex;
    const beforeSample = input[beforeIndex] ?? 0;
    const afterSample = input[afterIndex] ?? beforeSample;
    output[index] = beforeSample + (afterSample - beforeSample) * fraction;
  }

  return output;
}

function clampPcmSample(sample: number): number {
  return Math.max(-1, Math.min(1, sample));
}

export function encodeMonoPcm16(samples: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (const sample of samples) {
    const clamped = clampPcmSample(sample);
    const pcmValue = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(pcmValue), true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
