// Convert the device sample rate to mono 16kHz PCM without playing the microphone.
class NovaMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.sum = 0;
    this.weight = 0;
    this.chunk = new Int16Array(512); // 32ms at 16kHz.
    this.index = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const value of input) {
      let remaining = 1;
      while (remaining > 0) {
        const amount = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * amount;
        this.weight += amount;
        remaining -= amount;
        if (this.weight >= this.ratio - 1e-9) {
          const sample = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.chunk[this.index++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
          this.sum = 0;
          this.weight = 0;
          if (this.index === this.chunk.length) {
            this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
            this.chunk = new Int16Array(512);
            this.index = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("nova-microphone", NovaMicrophone);
