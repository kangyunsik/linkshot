// Original procedural boot/confirmation sounds. No downloads, speech service,
// random gunshot variations or asynchronous timers are involved.
function finish(samples) {
  let mean = 0; for (const value of samples) mean += value; mean /= samples.length;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const fade = Math.min(1, i / 64, (samples.length - 1 - i) / (samples.length * 0.06));
    samples[i] = (samples[i] - mean) * fade; peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= 0.88 / peak;
  samples[0] = 0; samples[samples.length - 1] = 0;
  return samples;
}

export function footstepSignal(sampleRate = 44100, foot = 0) {
  const samples = new Float32Array(Math.round(sampleRate * 0.21)); let seed = foot ? 8513 : 3191, low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1; low += (noise - low) * 0.16;
    const attack = Math.min(1, t / 0.002), toe = Math.max(0, t - 0.025);
    const heel = Math.sin(2 * Math.PI * (foot ? 87 : 91) * t) * Math.exp(-t / 0.032) * 0.25;
    const sole = low * Math.exp(-t / 0.042) * 1.6 + noise * Math.exp(-t / 0.018) * 0.12;
    const scrape = t > 0.025 ? (noise - low) * Math.exp(-toe / 0.045) * Math.min(1, toe / 0.008) * 0.13 : 0;
    samples[i] = (heel + sole + scrape) * attack;
  }
  return finish(samples);
}

export function killSignal(sampleRate = 44100, chain = 1, headshot = false) {
  const rank = Math.max(1, Math.min(8, Math.floor(Number(chain) || 1)));
  const roots = [659.255, 783.991, 880, 987.767, 1046.502, 1174.659, 1318.51, 1396.913];
  const root = roots[rank - 1], notes = rank === 1 ? [root, root * 1.5, root * 2] : [root, root * 1.25, root * 1.5, root * 2];
  const samples = new Float32Array(Math.round(sampleRate * (0.42 + Math.min(rank - 1, 4) * 0.035))); let seed = 7021, low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1; low += (noise - low) * 0.1;
    let value = (low * 0.7 + Math.sin(2 * Math.PI * 135 * t) * 0.25) * Math.exp(-t / 0.025);
    for (let index = 0; index < notes.length; index++) {
      const frequency = notes[index];
      const age = t - index * 0.052; if (age < 0) continue;
      const phase = 2 * Math.PI * frequency * age, envelope = Math.min(1, age / 0.003) * Math.exp(-age / 0.095);
      value += (Math.sin(phase) + Math.sin(phase * 2) * 0.18 + Math.sin(phase * 3) * 0.06) * envelope * 0.23;
    }
    if (headshot === true) value += Math.sin(2 * Math.PI * 2637.02 * t) * Math.min(1, t / 0.002) * Math.exp(-t / 0.045) * 0.13;
    samples[i] = value;
  }
  return finish(samples);
}
