// The same message protocol as WebSocket, backed by an isolated browser worker.
export class SoloConnection extends EventTarget {
  constructor() {
    super(); this.readyState = 0;
    this.worker = new Worker(new URL('./solo-worker.js', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', ({ data }) => {
      if (data.type === 'hello') this.readyState = 1;
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
    });
    this.worker.addEventListener('error', () => {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'error', message: '1인 플레이 시뮬레이션을 시작할 수 없습니다. 페이지를 새로고침해 주세요.' }) }));
      this.close();
    });
  }
  send(raw) { if (this.readyState === 1) this.worker.postMessage(JSON.parse(raw)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.worker.terminate(); this.dispatchEvent(new Event('close')); }
}
