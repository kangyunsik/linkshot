// Snapshot order is independent of wall-clock changes and round/life resets.
export class SnapshotOrder {
  constructor() { this.reset(); }
  reset() { this.sequence = -1; this.code = null; }
  accept(data) {
    const code = data.room?.code;
    if (this.code && code && code !== this.code) return false;
    if (data.sequence !== undefined) {
      if (!Number.isSafeInteger(data.sequence) || data.sequence < 0 || data.sequence <= this.sequence) return false;
      this.sequence = data.sequence;
    }
    this.code ||= code; return true;
  }
}
