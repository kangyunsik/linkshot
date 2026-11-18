export const isLoopbackHost = (host) => host === '127.0.0.1' || host === 'localhost';

export function isPrivateOnlineHost(host) {
  if (isLoopbackHost(host)) return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const [a, b, c, d] = host.split('.').map(Number);
  return [a, b, c, d].every((part) => part <= 255) && (a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168);
}

// Keep same-machine development URLs on the host used by the browser, in both
// directions: loopback previews of a LAN build, and LAN clients of a local build.
// Explicit remote APIs and HTTPS/WSS certificate hostnames are never rewritten.
export function onlineBrowserUrl(value, page = globalThis.location, frontendOrigin = '') {
  const url = new URL(value);
  const frontend = frontendOrigin ? new URL(frontendOrigin) : null;
  const sameDevelopmentComputer = isLoopbackHost(url.hostname) || frontend?.protocol === 'http:' && frontend.hostname === url.hostname && isPrivateOnlineHost(url.hostname);
  if (page && isLoopbackHost(page.hostname) && ['http:', 'ws:'].includes(url.protocol) && sameDevelopmentComputer) url.hostname = page.hostname;
  else if (page && isPrivateOnlineHost(page.hostname) && !isLoopbackHost(page.hostname) && (!page.protocol || page.protocol === 'http:') && isLoopbackHost(url.hostname) && ['http:', 'ws:'].includes(url.protocol)) url.hostname = page.hostname;
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
