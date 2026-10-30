import { createProfile, normalizeProfile, applyProfileOperation } from '../shared/progression.js';

export const PROFILE_KEY = 'linkshot-profile-v1';
const PENDING_STORAGE = 'linkshot-host-pending-v1';
function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }
function automaticId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class ProfileStore extends EventTarget {
  constructor({ storage = browserStorage(), fetcher = globalThis.fetch?.bind(globalThis), host = false, name = 'OPERATOR' } = {}) {
    super(); this.storage = storage; this.fetcher = fetcher; this.host = host; this.name = name;
    this.profile = null; this.scope = 'browser'; this.queue = []; this.draining = false; this.warning = null; this.retry = null;
  }

  async load() {
    let raw = null, savedText = null;
    try { savedText = this.storage?.getItem(PROFILE_KEY); if (savedText) raw = JSON.parse(savedText); }
    catch { try { if (savedText) this.storage?.setItem('linkshot-profile-recovery-v1', savedText); } catch { /* Storage itself may be blocked. */ } this.warning = '기존 프로필을 읽지 못했습니다. 복구용 사본을 보관했으며 브라우저 저장소 설정을 확인해야 합니다.'; }
    const fallback = automaticId();
    this.profile = raw ? normalizeProfile(raw, fallback) : createProfile(fallback, Date.now(), this.name);
    if (this.host) {
      try {
        const response = await this.fetcher('/api/profile', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Host profile unavailable');
        const data = await response.json();
        this.profile = normalizeProfile(data.profile, fallback); this.scope = 'host';
      } catch { this.warning = 'PC 저장 파일에 연결하지 못해 이 브라우저에 임시 저장합니다.'; this.scope = 'browser-fallback'; }
    }
    if (this.scope === 'host') {
      try {
        const pending = JSON.parse(this.storage?.getItem(PENDING_STORAGE) || 'null');
        if (pending?.id === this.profile.id && Array.isArray(pending.operations)) {
          for (const operation of pending.operations.slice(0, 1024)) {
            try {
              const result = applyProfileOperation(this.profile, operation);
              if (result.changed) { this.profile = result.profile; this.queue.push({ operation, resolve() {}, reject() {} }); }
            } catch { /* Discard malformed retry records, never arbitrary profile fields. */ }
          }
        }
      } catch { /* A corrupt retry cache does not replace the host's saved profile. */ }
    }
    this.persistLocal(); this.persistPending(); this.emitChange(); if (this.queue.length) this.drain();
    return this;
  }

  persistLocal() {
    try { if (!this.storage) throw new Error('No local storage'); this.storage.setItem(PROFILE_KEY, JSON.stringify(this.profile)); }
    catch { this.warning = '프로필을 저장하지 못했습니다. 이 창을 닫으면 변경사항이 사라질 수 있습니다.'; }
  }

  emitChange() { this.dispatchEvent(new Event('change')); }
  emitAward(award) { const event = new Event('award'); event.award = award; this.dispatchEvent(event); }
  get saving() { return this.queue.length > 0; }
  persistPending() {
    if (this.scope !== 'host') return;
    try { this.storage?.setItem(PENDING_STORAGE, JSON.stringify({ id: this.profile.id, operations: this.queue.map((entry) => entry.operation) })); } catch { this.warning = '저장 대기 기록을 보관하지 못했습니다. 실행 창을 닫기 전에 저장 상태를 확인하세요.'; }
  }

  refreshLocal() {
    if (this.scope === 'host') return;
    try {
      const raw = JSON.parse(this.storage?.getItem(PROFILE_KEY) || 'null');
      if (raw?.id === this.profile.id && raw.updatedAt >= this.profile.updatedAt) this.profile = normalizeProfile(raw, this.profile.id);
    } catch { /* Keep the already validated in-memory profile. */ }
  }

  operate(operation) {
    this.refreshLocal();
    const result = applyProfileOperation(this.profile, operation);
    if (!result.changed) return Promise.resolve(result);
    this.profile = result.profile; this.persistLocal(); this.emitChange();
    if (this.scope !== 'host') {
      if (result.award) this.emitAward(result.award);
      return Promise.resolve(result);
    }
    return new Promise((resolve, reject) => { this.queue.push({ operation, resolve, reject }); this.persistPending(); this.emitChange(); this.drain(); });
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length) {
      const pending = this.queue[0];
      try {
        const response = await this.fetcher('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.operation), signal: AbortSignal.timeout(5000) });
        const data = await response.json();
        if (!response.ok) {
          if (data.profile) this.profile = normalizeProfile(data.profile, this.profile.id);
          const error = new Error(data.message || 'PC 프로필 저장에 실패했습니다.'); error.permanent = response.status < 500; throw error;
        }
        this.queue.shift(); this.profile = normalizeProfile(data.profile, this.profile.id);
        for (const queued of this.queue) {
          try { this.profile = applyProfileOperation(this.profile, queued.operation).profile; } catch { /* The server will reject incompatible queued purchases. */ }
        }
        this.warning = null; this.persistLocal(); this.persistPending(); this.emitChange(); if (data.award) this.emitAward(data.award);
        pending.resolve({ profile: this.profile, award: data.award || null, changed: true, cost: data.cost || 0 });
      } catch (error) {
        if (error.permanent) {
          if (this.queue[0] === pending) this.queue.shift();
          for (const queued of this.queue) { try { this.profile = applyProfileOperation(this.profile, queued.operation).profile; } catch { /* The host rejects invalid operations individually. */ } }
          this.persistLocal(); this.persistPending(); this.emitChange(); pending.reject(error);
        } else {
          this.warning = 'PC 파일 저장 대기 중입니다. 기록은 이 브라우저에도 보관되며 연결되면 다시 저장합니다.';
          this.persistLocal(); this.persistPending(); this.emitChange();
          clearTimeout(this.retry); this.retry = setTimeout(() => this.drain(), 2000); break;
        }
      }
    }
    this.draining = false;
  }

  setName(callsign) { return this.operate({ type: 'name', callsign }); }
  syncRound(data) { return this.operate({ type: 'round', ...data }); }
  purchase(outfitId) { return this.operate({ type: 'purchase', outfitId }); }
  equip(outfitId) { return this.operate({ type: 'equip', outfitId }); }
}
