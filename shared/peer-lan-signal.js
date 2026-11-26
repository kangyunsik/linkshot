import { NETWORK_PROTOCOL } from './world.js';

const PREFIX = 'LSLAN1.';
const MAX_SDP = 12_000;
export const LAN_SIGNAL_LENGTH = 20_000;
const INVALID = '유효한 LINKSHOT LAN 초대 링크 또는 응답 코드를 입력해 주세요.';
const hostAddress = (address) => {
  if (/^[a-z0-9-]{1,63}\.local$/i.test(address) || address === '::1') return true;
  if (/^(?:f[cd][\da-f]{2}|fe[89ab][\da-f]):[\da-f:]+$/i.test(address)) {
    try { return !!new URL(`http://[${address}]/`).hostname; } catch { return false; }
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const [a, b, c, d] = address.split('.').map(Number);
  return [a, b, c, d].every(n => n <= 255) && (a === 10 || a === 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254);
};

// Data-only ICE on directly reachable interfaces. Do not include STUN/TURN,
// external candidates, or media sections in a URL pasted into the game.
function localSdp(sdp) {
  if (typeof sdp !== 'string' || sdp.length > MAX_SDP || !sdp.startsWith('v=0') || /[^\x09\x0a\x0d\x20-\x7e]/.test(sdp)) throw new Error(INVALID);
  const lines = sdp.trimEnd().split(/\r\n|\n|\r/);
  const media = lines.filter(line => line.startsWith('m='));
  if (media.length !== 1 || !/^m=application \d{1,5} (?:UDP\/)?DTLS\/SCTP (?:webrtc-datachannel|\d+)$/.test(media[0])) throw new Error(INVALID);
  const candidate = (line) => {
    const [, component, transport, , address, port, typ, kind] = line.split(/ +/);
    return component === '1' && /^(udp|tcp)$/i.test(transport) && Number(port) > 0 && Number(port) <= 65535 && typ === 'typ' && kind === 'host' && hostAddress(address);
  };
  const filtered = lines.filter(line => !line.startsWith('a=remote-candidates:') && (!line.startsWith('a=candidate:') || candidate(line)));
  if (!filtered.some(line => line.startsWith('a=candidate:'))) throw new Error('LAN 연결 주소를 얻지 못했습니다. 같은 네트워크인지 확인하고 브라우저의 로컬 네트워크 접근 요청을 허용해 주세요.');
  return filtered.map(line => {
    const match = /^c=IN IP([46]) (.+)$/.exec(line);
    if (match && !hostAddress(match[2])) return match[1] === '4' ? 'c=IN IP4 0.0.0.0' : 'c=IN IP6 ::';
    return line;
  }).join('\r\n') + '\r\n';
}

function checkedSignal(signal, type) {
  if (signal?.type !== type || !['offer', 'answer'].includes(type) || typeof signal.id !== 'string' || !/^[a-f0-9]{32}$/.test(signal.id)) throw new Error(INVALID);
  if (signal.version !== NETWORK_PROTOCOL) throw new Error('두 브라우저의 게임 버전이 다릅니다. 새로고침한 뒤 새 초대를 만들어 주세요.');
  return { type, id: signal.id, version: NETWORK_PROTOCOL, sdp: localSdp(signal.sdp) };
}

export function encodeLanSignal(type, id, sdp) {
  const value = checkedSignal({ type, id, sdp, version: NETWORK_PROTOCOL }, type);
  return PREFIX + btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeLanSignal(text, type) {
  let value = String(text ?? '').trim();
  if (value.length > LAN_SIGNAL_LENGTH) throw new Error(INVALID);
  if (type === 'offer' && !value.startsWith(PREFIX)) {
    try { const url = new URL(value); value = ['http:', 'https:'].includes(url.protocol) ? new URLSearchParams(url.hash.slice(1)).get('lan') || '' : ''; }
    catch { throw new Error(INVALID); }
  }
  const encoded = value.slice(PREFIX.length);
  if (!value.startsWith(PREFIX) || !/^[a-zA-Z0-9_-]+$/.test(encoded)) throw new Error(INVALID);
  let parsed;
  try { parsed = JSON.parse(atob(encoded.replaceAll('-', '+').replaceAll('_', '/'))); }
  catch { throw new Error(INVALID); }
  return checkedSignal(parsed, type);
}
