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
  const samples = new Float32Array(Math.round(sampleRate * 0.12)); let seed = foot ? 8513 : 3191;
  const detune = foot ? 0.974 : 1.026;
  const modes = [[460, 0.38, 0.012], [1040, 0.25, 0.008], [2180, 0.15, 0.0045], [3700, 0.07, 0.0025]];
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1; let value = 0;
    // Short hard-sole heel/toe contacts: a dry "do-gak", not a bass drum,
    // hiss or a long dragging scrape. Both feet keep the same steady cadence.
    for (let contact = 0; contact < 2; contact++) {
      const age = t - contact * 0.032; if (age < 0) continue;
      let impact = noise * Math.exp(-age / 0.0018) * 0.11;
      for (let mode = 0; mode < modes.length; mode++) {
        const [frequency, gain, decay] = modes[mode];
        impact += Math.sin(2 * Math.PI * frequency * detune * (contact ? 1.28 : 1) * age) * gain * Math.exp(-age / decay);
      }
      value += impact * Math.min(1, age / 0.0006) * (contact ? 0.72 : 1);
    }
    samples[i] = value;
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
