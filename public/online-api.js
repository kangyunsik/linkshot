// Online identity is a server session, never a localStorage bearer token or an
// imported device profile. The configured URL is public configuration, not a key.
export class OnlineApi {
  constructor(baseUrl) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('온라인 API 주소를 확인하세요.');
    if (globalThis.location?.protocol === 'https:' && url.protocol !== 'https:') throw new Error('HTTPS 페이지에는 HTTPS 온라인 API가 필요합니다.');
    this.base = url.href.replace(/\/$/, ''); this.token = null;
  }
  async request(path, { method = 'GET', body, form = false, csrf = true } = {}) {
    if (method !== 'GET' && csrf && !this.token) await this.refreshCsrf();
    const response = await fetch(this.base + path, { method, credentials: 'include', redirect: 'error', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }), ...(method === 'GET' || !csrf ? {} : { 'X-CSRF-TOKEN': this.token }) }, ...(body === undefined ? {} : { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) { if (response.status === 403) this.token = null; const error = new Error(data?.message || `온라인 요청 실패 (${response.status})`); error.status = response.status; throw error; }
    return data;
  }
  health() { return this.request('/api/health'); }
  async refreshCsrf() { const data = await this.request('/api/auth/csrf', { csrf: false }); if (typeof data?.token !== 'string' || data.token.length > 512 || data.headerName !== 'X-CSRF-TOKEN') throw new Error('온라인 인증 응답을 확인할 수 없습니다.'); this.token = data.token; }
  profile() { return this.request('/api/account'); }
  queue(mode) { return this.request('/api/queue', { method: 'POST', body: { mode } }); }
  queueStatus() { return this.request('/api/queue'); }
  cancelQueue() { return this.request('/api/queue', { method: 'DELETE' }); }
  queueHeartbeat() { return this.request('/api/queue/heartbeat', { method: 'POST' }); }
  ticket() { return this.request('/api/match/ticket', { method: 'POST' }); }
  customTicket() { return this.request('/api/custom/ticket', { method: 'POST' }); }
  receipt(id) { return this.request(`/api/results/${encodeURIComponent(id)}`); }
  history() { return this.request('/api/results'); }
  register(username, password, callsign) { return this.request('/api/auth/register', { method: 'POST', body: { username, password, callsign } }); }
  async login(username, password) { const result = await this.request('/api/auth/login', { method: 'POST', form: true, body: { username, password } }); this.token = null; await this.refreshCsrf(); return result.profile; }
  async logout() { await this.request('/api/auth/logout', { method: 'POST' }); this.token = null; }
}
