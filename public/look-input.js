// Pointer-lock/fullscreen transitions can report a cursor-warp delta. Reject
// only transition-sized warps, not deliberate fast turns during normal play.
export class LookInput {
  constructor() { this.transitionUntil = 0; }
  transition(now) { this.transitionUntil = now + 120; }
  delta(event, width, height, now) {
    const x = event.movementX, y = event.movementY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (now < this.transitionUntil && (Math.abs(x) >= Math.max(256, width * .45) || Math.abs(y) >= Math.max(256, height * .45))) return null;
    if (Math.abs(x) > Math.max(4096, width * 3) || Math.abs(y) > Math.max(4096, height * 3)) return null;
    return { x, y };
  }
}
