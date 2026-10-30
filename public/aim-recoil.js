const MAX_PITCH = 1.48;
const MAX_KICK = MAX_PITCH;
const RETURN_DELAY_MS = 150;
const RETURN_RATE = 10;
const REST_THRESHOLD = 0.00001;
const clampPitch = (value) => Math.max(-MAX_PITCH, Math.min(MAX_PITCH, value));

// Keep the mouse-controlled aim separate from a temporary view kick. The
// composed pitch is used by both the camera and outgoing authoritative aim.
export class AimRecoil {
  constructor() { this.reset(); }

  get pitch() { return clampPitch(this.aimPitch + this.offset); }

  reset(pitch = 0) {
    this.aimPitch = clampPitch(Number.isFinite(pitch) ? pitch : 0);
    this.offset = 0; this.lastKickAt = -Infinity; this.updatedAt = null;
  }

  move(delta) {
    if (!Number.isFinite(delta)) return;
    this.aimPitch = clampPitch(this.aimPitch + delta);
    this.offset = Math.min(this.offset, MAX_PITCH - this.aimPitch);
  }

  kick(amount, now) {
    if (!Number.isFinite(amount) || !Number.isFinite(now) || amount <= 0) return;
    this.update(now);
    this.offset = Math.min(MAX_KICK, MAX_PITCH - this.aimPitch, this.offset + amount);
    this.lastKickAt = now;
  }

  update(now) {
    if (!Number.isFinite(now)) return;
    const start = Math.max(this.updatedAt ?? now, this.lastKickAt + RETURN_DELAY_MS);
    if (now > start) this.offset *= Math.exp(-RETURN_RATE * (now - start) / 1000);
    if (this.offset < REST_THRESHOLD) this.offset = 0;
    this.updatedAt = Math.max(this.updatedAt ?? now, now);
  }
}
