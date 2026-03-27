/* oxlint-disable unicorn/require-post-message-target-origin */

class SamscodePcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}

registerProcessor("samscode-pcm-capture", SamscodePcmCaptureProcessor);
