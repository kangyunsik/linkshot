// Original procedural effects: no downloads and no changes to gun recordings.
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
  const samples = new Float32Array(Math.round(sampleRate * 0.12)); let seed = foot ? 8513 : 3191, noise = 0, previous = 0, filtered = 0;
  const detune = foot ? 0.993 : 1.007, noiseAlpha = 1 - Math.exp(-2 * Math.PI * 1300 / sampleRate);
  const dcDecay = Math.exp(-2 * Math.PI * 40 / sampleRate);
  const modes = [[245, 0.46, 0.0095], [565, 0.18, 0.0048], [1080, 0.045, 0.0028], [1820, 0.008, 0.0016]];
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noise += (seed / 2147483648 - 1 - noise) * noiseAlpha; let value = 0;
    // Short hard-sole heel/toe contacts: a dry "do-gak", not a bass drum,
    // hiss or a long dragging scrape. Low, quickly damped modes avoid a high
    // wood-block pitch; heel/toe and left/right pitch differences stay subtle.
    for (let contact = 0; contact < 2; contact++) {
      const age = t - contact * 0.032; if (age < 0) continue;
      let impact = noise * Math.exp(-age / 0.0018) * 0.06;
      for (let mode = 0; mode < modes.length; mode++) {
        const [frequency, gain, decay] = modes[mode];
        impact += Math.sin(2 * Math.PI * frequency * detune * (contact ? 1.06 : 1) * age) * gain * Math.exp(-age / decay);
      }
      value += impact * Math.min(1, age / 0.0006) * (contact ? 0.72 : 1);
    }
    // Remove sub-audible/DC bias locally so normalization cannot leave a flat
    // tail after these lower-pitched impacts. Kill cues remain unchanged.
    filtered = dcDecay * (filtered + value - previous); previous = value; samples[i] = filtered;
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

export function bulletPassSignal(sampleRate = 44100, variant = 0) {
  const length = .098 + variant * .009, samples = new Float32Array(Math.round(sampleRate * length));
  let seed = 1579 + variant * 2909, upper = 0, lower = 0, phase = 0;
  const smoothing = 1 - Math.exp(-2 * Math.PI * 6200 / sampleRate);
  const body = 1 - Math.exp(-2 * Math.PI * 1530 / sampleRate);
  const crossing = .020 + variant * .0035;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    upper += (noise - upper) * smoothing;
    lower += (upper - lower) * body;
    const air = t - crossing;
    const rush = air < 0 ? Math.exp(air / .011) : Math.exp(-air / (.016 + variant * .002));
    const transient = (air - .001) / .0042, snap = Math.exp(-transient * transient);
    // A narrow bright air transient opens into a falling, breathy tail.
    // There is no second gunshot and the weak pitch is masked by the rush.
    phase += 2 * Math.PI * (790 + (2760 + variant * 160) * Math.exp(-t / .024)) / sampleRate;
    samples[i] = (upper - lower) * (rush * .65 + snap * .54)
      + lower * rush * .13 + Math.sin(phase) * rush * (.031 + .013 * lower);
  }
  return finish(samples);
}

export function incomingImpactSignal(sampleRate = 44100, headshot = false, variant = 0) {
  const samples = new Float32Array(Math.round(sampleRate * (headshot ? .119 : .144)));
  let seed = 9029 + 3851 * variant, low = 0, mid = 0, upper = 0;
  const filter = hz => 1 - Math.exp(-2 * Math.PI * hz / sampleRate);
  const lowAlpha = filter(210), midAlpha = filter(940), upperAlpha = filter(headshot ? 3450 : 2130);
  const modes = headshot ? [[192, .22, .009], [369, .15, .0068], [731, .09, .004]]
    : [[116, .42, .018], [204, .19, .013], [358, .082, .007]];
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    upper += (noise - upper) * upperAlpha;
    mid += (upper - mid) * midAlpha;
    low += (mid - low) * lowAlpha;
    const contact = .0021 + variant * .00042;
    const cloth = t - (.013 + variant * .0017);
    // One soft, weighted contact plus a brief fabric/grain decay, not a
    // feedback beep, long hiss, or exaggerated second impact.
    let value = (upper - mid) * (.26 * Math.exp(-t / contact) + (headshot ? .13 : .065) * Math.exp(-t / .009));
    value += (mid - low) * (.44 * Math.exp(-t / .016) + (cloth > 0 ? .105 * (1 - Math.exp(-cloth / .004)) * Math.exp(-cloth / .014) : 0));
    value += low * .68 * Math.exp(-t / .023);
    for (const [hz, gain, decay] of modes) value += Math.sin(2 * Math.PI * hz * (1 - variant * .014) * t) * gain * Math.exp(-t / decay);
    samples[i] = value * Math.min(1, t / .0012);
  }
  return finish(samples);
}
