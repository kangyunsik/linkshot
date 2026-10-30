import { WEAPONS } from '/shared/catalog.js';
import { NETWORK_PROTOCOL } from '/shared/world.js';

export class GameAudio {
  constructor(settings) {
    this.settings = settings;
    this.context = null;
    this.muted = false;
    this.samples = new Map(); this.voices = new Set();
    this.bytes = Promise.allSettled(WEAPONS.flatMap((weapon) => [1].map(async (variant) => {
      const response = await fetch(`/assets/sounds/${weapon.id}-${variant}.wav?v=${NETWORK_PROTOCOL}`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Sound sample unavailable');
      return { id: weapon.id, variant, bytes: await response.arrayBuffer() };
    })));
  }

  async unlock() {
    try {
      if (!this.context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        this.context = new Audio();
        this.master = this.context.createGain();
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -10; this.limiter.knee.value = 12; this.limiter.ratio.value = 8; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.12;
        this.master.connect(this.limiter).connect(this.context.destination);
        this.room = this.context.createConvolver(); this.roomGain = this.context.createGain(); this.roomGain.gain.value = 0.055;
        const impulse = this.context.createBuffer(2, this.context.sampleRate * 0.32, this.context.sampleRate);
        for (let channel = 0; channel < 2; channel++) { const data = impulse.getChannelData(channel); for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.context.sampleRate * 0.05)) * 0.18; }
        this.room.buffer = impulse; this.room.connect(this.roomGain).connect(this.master);
        const length = this.context.sampleRate * 0.25;
        this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      await this.context.resume();
      this.updateVolume();
      this.ready ||= this.bytes.then((results) => Promise.allSettled(results.filter((result) => result.status === 'fulfilled').map(async ({ value }) => {
        const buffer = await this.context.decodeAudioData(value.bytes);
        if (!this.samples.has(value.id)) this.samples.set(value.id, []);
        this.samples.get(value.id)[value.variant - 1] = buffer;
      })));
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

  setEnvironment(indoors) { if (this.roomGain) this.roomGain.gain.setTargetAtTime(indoors ? 0.17 : 0.055, this.context.currentTime, 0.12); }

  shot(volume = 1, pan = 0, weaponId = 'rifle', distance = 0, allowed = null) {
    if (allowed && !allowed()) return;
    if (!this.context || this.context.state !== 'running') return;
    const available = (this.samples.get(weaponId) || []).filter(Boolean);
    if (available.length) {
      const source = this.context.createBufferSource(), gain = this.context.createGain(), filter = this.context.createBiquadFilter(), panner = this.context.createStereoPanner();
      source.buffer = available[0]; source.playbackRate.value = 1;
      gain.gain.value = Math.max(0, Math.min(1, volume)); filter.type = 'lowpass'; filter.frequency.value = Math.max(1800, 14500 * Math.exp(-distance / 32));
      panner.pan.value = Math.max(-1, Math.min(1, pan)); source.connect(filter).connect(gain).connect(panner); panner.connect(this.master); panner.connect(this.room);
      if (this.voices.size >= 40) { const oldest = this.voices.values().next().value; oldest.stop(); this.voices.delete(oldest); }
      this.voices.add(source); source.onended = () => { this.voices.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); panner.disconnect(); };
      source.start(); return;
    }
    // Never substitute a mechanical/beep-like fallback for a gunshot. A very
    // early first shot may wait briefly for the same canonical recording.
    const queuedAt = performance.now();
    this.ready?.then(() => { if ((!allowed || allowed()) && performance.now() - queuedAt < 350 && this.samples.get(weaponId)?.some(Boolean)) this.shot(volume, pan, weaponId, distance, allowed); });
  }
  step(sprint = false, crouched = false) { this.burst(0.07, crouched ? 0.025 : sprint ? 0.085 : 0.05, 450); }
  reload() { this.tone(1100, 0.07, 0.08, 'triangle', 240); this.burst(0.1, 0.07, 1900); }
  hit(head = false) { this.tone(head ? 1800 : 1150, 0.07, 0.12, 'sine', head ? 2500 : 1450); }
  hurt() { this.burst(0.16, 0.1, 320); }
  kill() { this.tone(660, 0.16, 0.1, 'sine', 990); }
}
