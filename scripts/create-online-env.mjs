import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const file = new URL('../online-server/.env', import.meta.url);
const values = `# Private local development configuration. Never commit this file.\nDATABASE_PASSWORD=${randomBytes(32).toString('base64url')}\nENGINE_SECRET=${randomBytes(48).toString('base64url')}\nONLINE_API_URL=http://127.0.0.1:8080\nENGINE_PUBLIC_URL=ws://127.0.0.1:8090/play\nFRONTEND_ORIGINS=http://127.0.0.1:4173\n`;
try { await writeFile(file, values, { flag: 'wx', mode: 0o600 }); console.log('Created private online-server/.env. No values were printed.'); }
catch (error) { if (error.code !== 'EEXIST') throw error; console.log('Existing online-server/.env was preserved.'); }
