export const QUALITY_PRESETS = Object.freeze({
  normal: Object.freeze({ pixelRatio: 1.65, shadowSize: 2048, lamps: true }),
  balanced: Object.freeze({ pixelRatio: 1, shadowSize: 1024, lamps: true }),
  low: Object.freeze({ pixelRatio: .75, shadowSize: 0, lamps: false }),
});
export const normalizeQuality = (quality) => typeof quality === 'string' && Object.hasOwn(QUALITY_PRESETS, quality) ? quality : 'normal';
export const qualityPreset = (quality) => QUALITY_PRESETS[normalizeQuality(quality)];

// Only visual IK is throttled. Movement, interpolation, hitboxes and audio still
// advance every frame, including for off-screen players casting visible shadows.
export class AvatarPoseSchedule {
  constructor() { this.reset(); }
  reset() { this.time = -Infinity; this.inView = false; this.weapon = null; }
  update(now, inView, distanceSq, crouch, stride, pitch, weapon) {
    const entering = inView && !this.inView; this.inView = inView;
    if (!entering && this.weapon === weapon && this.crouch === crouch && this.stride === stride && this.pitch === pitch) return false;
    const interval = inView ? distanceSq < 900 ? 0 : 1000 / 30 : 100;
    if (!entering && now - this.time + .001 < interval) return false;
    this.time = now; this.weapon = weapon; this.crouch = crouch; this.stride = stride; this.pitch = pitch;
    return true;
  }
}

// Fixed-size samples avoid per-frame arrays/sorting. Summaries are requested
// once per second; CPU time is JS/render submission, not GPU execution time.
export class FrameStats {
  constructor(capacity = 120) {
    this.frames = new Float64Array(capacity); this.cpu = new Float64Array(capacity);
    this.count = 0; this.index = 0; this.previous = null; this.calls = 0; this.triangles = 0; this.poseUpdates = 0;
  }
  record(now, cpuMs, render, poseUpdates = 0) {
    if (this.previous !== null && now > this.previous) {
      this.frames[this.index] = now - this.previous; this.cpu[this.index] = cpuMs;
      this.index = (this.index + 1) % this.frames.length; this.count = Math.min(this.count + 1, this.frames.length);
    }
    this.previous = now; this.calls = render.calls; this.triangles = render.triangles; this.poseUpdates = poseUpdates;
  }
  summary() {
    const frames = Array.from(this.frames.subarray(0, this.count)).sort((a, b) => a - b);
    const cpu = Array.from(this.cpu.subarray(0, this.count)).sort((a, b) => a - b);
    const total = frames.reduce((sum, value) => sum + value, 0), percentile = Math.max(0, Math.ceil(this.count * .95) - 1);
    return { fps: total ? Math.round(this.count * 1000 / total) : 0, frameP95Ms: frames[percentile] || 0, cpuP95Ms: cpu[percentile] || 0, calls: this.calls, triangles: this.triangles, poseUpdates: this.poseUpdates };
  }
}
