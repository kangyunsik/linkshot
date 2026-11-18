import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOnlineHost, onlineBrowserOrigins, onlineBrowserUrl } from '../shared/online-network.js';

const lanHost = [192, 168, 40, 25].join('.'), otherHost = [192, 168, 40, 26].join('.');

test('loopback previews use their own host for private HTTP APIs and combat sockets while retaining ports and paths', () => {
  for (const hostname of ['127.0.0.1', 'localhost']) for (const scheme of ['http', 'ws']) {
    const url = onlineBrowserUrl(`${scheme}://${lanHost}:8181/api/path`, { hostname }, `http://${lanHost}:4173`);
    assert.equal(url.href, `${scheme}://${hostname}:8181/api/path`);
  }
  for (const value of ['https://api.example.invalid/api', 'http://api.example.invalid:8080', `https://${lanHost}:8080`, `wss://${lanHost}:8090/play`, 'http://8.8.8.8:8080']) assert.equal(onlineBrowserUrl(value, { hostname: '127.0.0.1' }).href, new URL(value).href);
  const lan = `http://${lanHost}:8080/api`; assert.equal(onlineBrowserUrl(lan, { hostname: otherHost }).href, lan); assert.equal(onlineBrowserUrl(lan).href, lan);
  assert.equal(onlineBrowserUrl(lan, { hostname: '127.0.0.1' }, `http://${otherHost}:4173`).href, lan);
  assert.equal(onlineBrowserUrl(lan, { hostname: '127.0.0.1' }).href, lan);
});

test('another LAN computer resolves local API and combat tickets against the server IP, never its own localhost', () => {
  for (const configured of ['localhost', '127.0.0.1']) for (const scheme of ['http', 'ws']) {
    const url = onlineBrowserUrl(`${scheme}://${configured}:8181/api/path`, { hostname: lanHost, protocol: 'http:' }, 'http://localhost:4173');
    assert.equal(url.href, `${scheme}://${lanHost}:8181/api/path`);
    assert.equal(url.port, '8181'); assert.equal(url.pathname, '/api/path');
  }
  for (const value of ['https://localhost:8080/api', 'wss://localhost:8090/play', `http://${otherHost}:8080/api`, 'https://api.example.invalid/api']) assert.equal(onlineBrowserUrl(value, { hostname: lanHost, protocol: 'http:' }).href, value);
  assert.equal(onlineBrowserUrl('http://localhost:8080', { hostname: 'game.example.invalid', protocol: 'http:' }).href, 'http://localhost:8080/');
});

test('LAN origin allowlists include only matching-port loopback aliases, never arbitrary origins or production aliases', () => {
  assert.deepEqual(onlineBrowserOrigins([`http://${lanHost}:4181`]), [`http://${lanHost}:4181`, 'http://127.0.0.1:4181', 'http://localhost:4181']);
  assert.deepEqual(onlineBrowserOrigins(['http://127.0.0.1:4173', 'http://localhost:4173']), ['http://127.0.0.1:4173', 'http://localhost:4173']);
  for (const origin of ['https://game.example.invalid', 'http://game.example.invalid', `https://${lanHost}:4173`]) assert.deepEqual(onlineBrowserOrigins([origin]), [origin]);
  const credentialed = new URL('http://localhost:4173'); credentialed.username = 'test-user'; credentialed.password = 'test-only-value';
  for (const origin of ['http://*.example.invalid', 'http://localhost:4173/path', credentialed.href, 'ws://localhost:4173']) assert.throws(() => onlineBrowserOrigins([origin]));
  const privateHosts = [[192, 168, 1, 2], [10, 2, 3, 4], [172, 16, 0, 1], [172, 31, 255, 254]].map((parts) => parts.join('.'));
  for (const host of [...privateHosts, '127.0.0.1', 'localhost']) assert.equal(isPrivateOnlineHost(host), true);
  const otherHosts = [[172, 15, 0, 1], [172, 32, 0, 1], [192, 168, 999, 1]].map((parts) => parts.join('.'));
  for (const host of [...otherHosts, '127.0.0.1.example.invalid', '10.example.invalid']) assert.equal(isPrivateOnlineHost(host), false);
});
