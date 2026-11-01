import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const publicUrl = new URL(process.env.FRONTEND_URL || 'http://127.0.0.1:4173');
if (publicUrl.protocol !== 'http:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/') throw new Error('FRONTEND_URL must be the public HTTP preview origin.');
const port = Number(process.env.PREVIEW_PORT) || Number(publicUrl.port) || 4173;
publicUrl.port = String(port);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) { res.writeHead(403); res.end(); return; }
    const details = await stat(file); if (!details.isFile()) throw new Error('Not found');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': details.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404); res.end('Not found. Run npm run build first.'); }
});
server.listen(port, '0.0.0.0', () => console.log(`FE 미리보기: ${publicUrl.origin} · 종료: Ctrl+C`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => process.exit(0)); server.closeAllConnections(); });
