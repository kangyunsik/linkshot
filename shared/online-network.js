export const isLoopbackHost = (host) => host === '127.0.0.1' || host === 'localhost';

export function isPrivateOnlineHost(host) {
  if (isLoopbackHost(host)) return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const [a, b, c, d] = host.split('.').map(Number);
  return [a, b, c, d].every((part) => part <= 255) && (a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168);
}

// Local previews may retain a LAN address from an earlier network. Keep API
// cookies and combat tickets on the browser's loopback host without rewriting
// LAN clients, public servers or HTTPS/WSS certificate hostnames.
export function onlineBrowserUrl(value, page = globalThis.location, frontendOrigin = '') {
  const url = new URL(value);
  const frontend = frontendOrigin ? new URL(frontendOrigin) : null;
  const sameDevelopmentComputer = isLoopbackHost(url.hostname) || frontend?.protocol === 'http:' && frontend.hostname === url.hostname && isPrivateOnlineHost(url.hostname);
  if (page && isLoopbackHost(page.hostname) && ['http:', 'ws:'].includes(url.protocol) && sameDevelopmentComputer) url.hostname = page.hostname;
  return url;
}

export function onlineBrowserOrigins(configured) {
  const origins = new Set(configured);
  for (const origin of configured) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || origin.includes('*')) throw new Error('FRONTEND_ORIGINS must list explicit HTTP(S) origins.');
    if (url.protocol !== 'http:' || !isPrivateOnlineHost(url.hostname)) continue;
    for (const host of ['127.0.0.1', 'localhost']) { const local = new URL(origin); local.hostname = host; origins.add(local.origin); }
  }
  return [...origins];
}
