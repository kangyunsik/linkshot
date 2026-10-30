export class GameAudio {
  constructor(settings) {
    this.settings = settings;
    this.context = null;
    this.muted = false;
  }

  async unlock() {
    try {
      if (!this.context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        this.context = new Audio();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        const length = this.context.sampleRate * 0.25;
        this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      await this.context.resume();
      this.updateVolume();
    } catch { /* Browsers without Web Audio can still play. */ }
  }

  updateVolume() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.settings.volume / 100 * 0.45, this.context.currentTime, 0.02);
  }

  tone(frequency, duration, volume = 0.1, type = 'sine', endFrequency = frequency, pan = 0) {
    if (!this.context || this.context.state !== 'running') return;
    const c = this.context, t = c.currentTime;
    const oscillator = c.createOscillator(), gain = c.createGain(), panner = c.createStereoPanner();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    panner.pan.value = pan;
    oscillator.connect(gain).connect(panner).connect(this.master);
    oscillator.start(t); oscillator.stop(t + duration + 0.01);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); panner.disconnect(); };
  }

  burst(duration, volume, frequency, pan = 0) {
    if (!this.context || this.context.state !== 'running') return;
    const c = this.context, t = c.currentTime;
    const source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain(), panner = c.createStereoPanner();
    source.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    panner.pan.value = pan;
    source.connect(filter).connect(gain).connect(panner).connect(this.master);
    source.start(t); source.stop(t + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); panner.disconnect(); };
  }

  shot(volume = 1, pan = 0, weaponId = 'rifle') {
    const [duration, frequency, bass] = weaponId === 'smg' ? [0.08, 4700, 185] : weaponId === 'shotgun' ? [0.22, 1900, 85] : weaponId === 'sniper' ? [0.24, 2600, 70] : weaponId === 'pistol' ? [0.10, 4200, 170] : weaponId === 'lmg' ? [0.15, 3200, 110] : weaponId === 'dmr' ? [0.17, 2700, 95] : [0.13, 3600, 135];
    this.burst(duration, volume * 0.55, frequency, pan);
    this.tone(bass, duration, volume * 0.3, 'triangle', 30, pan);
    this.tone(1800, 0.025, volume * 0.04, 'square', 260, pan);
  }
  step(sprint = false, crouched = false) { this.burst(0.07, crouched ? 0.025 : sprint ? 0.085 : 0.05, 450); }
  reload() { this.tone(1100, 0.07, 0.08, 'triangle', 240); this.burst(0.1, 0.07, 1900); }
  hit(head = false) { this.tone(head ? 1800 : 1150, 0.07, 0.12, 'sine', head ? 2500 : 1450); }
  hurt() { this.burst(0.16, 0.1, 320); }
  kill() { this.tone(660, 0.16, 0.1, 'sine', 990); }
}
