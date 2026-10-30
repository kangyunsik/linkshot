// Match server acknowledgements by trigger + bullet, never by weapon or elapsed
// time: a delayed acknowledgement is not another gunshot.
export class ShotFeedback {
  constructor() { this.reset(); }
  reset() { this.predictions = new Set(); this.events = new Set(); }
  key(shot) { return Number.isSafeInteger(shot.fireSeq) && Number.isSafeInteger(shot.shotIndex) ? `${shot.fireSeq}:${shot.shotIndex}` : null; }
  remember(set, key) { if (!key) return; set.add(key); if (set.size > 2048) set.delete(set.values().next().value); }
  predict(fireSeq, shotIndex) { this.remember(this.predictions, this.key({ fireSeq, shotIndex })); }
  acknowledge(shot) {
    const key = this.key(shot), eventId = shot.shotId || (key && `${shot.id}:${key}`);
    if (eventId && this.events.has(eventId)) return { duplicate: true, predicted: false };
    this.remember(this.events, eventId);
    return { duplicate: false, predicted: !!key && this.predictions.has(key) };
  }
}
