export class FencingAudio {
  private context?: AudioContext;
  private master?: GainNode;
  enabled = true;

  private ensure() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  private tone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.25, delay = 0) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.72), start + duration);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.master!);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume: number, highpass = 700) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.master!);
    source.start();
  }

  step() { this.noise(0.055, 0.11, 120); }
  swish() { this.noise(0.16, 0.15, 1100); }
  blade() {
    this.noise(0.19, 0.24, 1800);
    this.tone(2100, 0.23, 'triangle', 0.12);
    this.tone(3170, 0.15, 'sine', 0.07, 0.012);
  }
  hit(valid = true) {
    this.tone(valid ? 840 : 320, 0.14, 'square', 0.16);
    if (valid) this.tone(1240, 0.24, 'sine', 0.14, 0.09);
  }
  command(allez = false) {
    this.tone(allez ? 660 : 420, 0.12, 'sine', 0.15);
    if (allez) this.tone(880, 0.2, 'sine', 0.12, 0.1);
  }
}
