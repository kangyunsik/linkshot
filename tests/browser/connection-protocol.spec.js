import { test, expect } from '@playwright/test';
import http from 'node:http';
import { WebSocketServer } from 'ws';

test('rated and custom transports reject an old server before spending a ticket or entering a match', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); const sent = [], server = http.createServer(), sockets = new WebSocketServer({ server, path: '/play' });
  sockets.on('connection', (socket) => { socket.on('message', (data) => sent.push(JSON.parse(data))); socket.send(JSON.stringify({ type: 'hello', protocolVersion: 0 })); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/'); const result = await page.evaluate(async (engineUrl) => {
      const [{ OnlineConnection }, { CustomConnection }] = await Promise.all([import('/online-connection.js'), import('/custom-connection.js')]); const result = [];
      for (const Connection of [OnlineConnection, CustomConnection]) {
        const ticket = { ticket: 'x'.repeat(43), engineUrl, matchId: '00000000-0000-4000-8000-000000000001' }, api = { ticket: async () => ticket, customTicket: async () => ticket };
        await new Promise((resolve, reject) => { const connection = new Connection(api), errors = []; const timer = setTimeout(() => { connection.close(); reject(new Error('Protocol rejection timed out')); }, 5000); connection.addEventListener('message', (event) => { const data = JSON.parse(event.data); if (data.type === 'error') errors.push(data.message); }); connection.addEventListener('close', () => { clearTimeout(timer); result.push({ errors, closed: connection.readyState === 3 }); resolve(); }); });
      }
      return result;
    }, `ws://127.0.0.1:${server.address().port}/play`);
    expect(sent).toEqual([]); expect(result).toHaveLength(2); for (const item of result) { expect(item.closed).toBe(true); expect(item.errors.join(' ')).toContain('서버'); }
  } finally { for (const socket of sockets.clients) socket.terminate(); await new Promise((resolve) => sockets.close(resolve)); await new Promise((resolve) => server.close(resolve)); }
});
