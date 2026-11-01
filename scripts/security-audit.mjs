import { cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = [
  ['private-key', /-{5}BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-{5}/g],
  ['github-token', /\b(?:gh[opusr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ['ai-api-key', /\b(?:sk-proj-[A-Za-z0-9_-]{25,}|sk-ant-[A-Za-z0-9_-]{25,}|sk-[A-Za-z0-9]{32,}|hf_[A-Za-z0-9]{30,})\b/g],
  ['package-token', /\b(?:npm_[A-Za-z0-9]{30,}|pypi-[A-Za-z0-9_-]{40,})\b/g],
  ['service-token', /\b(?:xox[baprs]-[A-Za-z0-9-]{20,}|[sr]k_live_[A-Za-z0-9]{20,})\b/g],
  ['credentialed-url', /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/:'"<>]+:[^\s/@'"<>]{3,}@[^\s/'"<>]+/g],
  ['absolute-user-path', /(?:\/(?:Users|home)\/[^\s/'"<>]+|[A-Za-z]:\\+(?:Users|Documents and Settings)\\+[^\s\\'"<>]+)/g],
  ['private-network-address', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g],
  ['secret-literal', /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*['"][A-Za-z0-9_+\/=.-]{20,}['"]/gi],
];

// Never return the matching value: reports and CI logs contain only rule IDs/line numbers.
export function checkText(text) {
  const findings = [];
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (rule === 'secret-literal' && /['"](?:your[_-]|example[_-]|placeholder|change[_-]?me|dummy[_-]|\$\{)/i.test(match[0])) continue;
      findings.push({ rule, line: text.slice(0, match.index).split('\n').length });
      if (findings.filter((entry) => entry.rule === rule).length >= 5) break;
    }
  }
  return findings;
}

export function pngMetadata(bytes) {
  if (bytes.length < 12 || bytes.readUInt32BE(0) !== 0x89504e47) return [];
  const result = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + size + 12 > bytes.length) throw new Error('Truncated PNG metadata');
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (['tEXt', 'zTXt', 'iTXt'].includes(type)) {
      const end = data.indexOf(0); if (end < 0) throw new Error('Invalid PNG text chunk');
      const key = data.toString('utf8', 0, end); let text;
      if (type === 'tEXt') text = data.subarray(end + 1).toString('utf8');
      if (type === 'zTXt') text = inflateSync(data.subarray(end + 2), { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8');
      if (type === 'iTXt') {
        const compressed = data[end + 1], languageEnd = data.indexOf(0, end + 3), translatedEnd = data.indexOf(0, languageEnd + 1);
        if (languageEnd < 0 || translatedEnd < 0) throw new Error('Invalid PNG international text chunk');
        const payload = data.subarray(translatedEnd + 1);
        text = (compressed ? inflateSync(payload, { maxOutputLength: 16 * 1024 * 1024 }) : payload).toString('utf8');
      }
      result.push({ key, text });
    }
    if (type === 'eXIf') result.push({ key: 'EXIF', text: data.toString('latin1') });
    offset += size + 12;
    if (type === 'IEND') break;
  }
  return result;
}

export function publicationRisk(file) {
  const name = path.posix.basename(file);
  if (/^(?:node_modules|\.toolchain|artifacts|dist|release|test-results|playwright-report|\.vercel)\//.test(file)) return 'private-build-output';
  if (/^online-server\/target\//.test(file) || /\.(?:jar|war|class)$/i.test(name)) return 'private-build-output';
  if (/^next-plan\.md$/i.test(name)) return 'local-planning-file';
  if (/^\.env(?:\.|$)/.test(name) && !/\.(?:example|sample)$/.test(name)) return 'environment-file';
  if (/^(?:\.npmrc|\.pypirc|\.netrc|\.htpasswd|id_rsa|id_ed25519)$/.test(name) || /\.(?:key|p12|pfx|keystore|jks)$/i.test(name) || /(?:credentials|service-account).*\.json$/i.test(name)) return 'credential-file';
  if (/^(?:profile|profiles|linkshot-profile)(?:[.-].*)?\.json(?:\.tmp)?$/i.test(name) || /^(?:data|\.linkshot)\//.test(file)) return 'personal-progression-data';
  if (/\.(?:exe|zip|tar\.gz|log)$/i.test(name)) return 'generated-or-local-file';
  return null;
}

export async function publicationFiles(directory, temporary) {
  const options = { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 };
  let prefix = [];
  try { execFileSync('git', ['rev-parse', '--show-toplevel'], options); }
  catch {
    // Use Git's actual ignore semantics without creating/changing a repository in the project.
    const repository = path.join(temporary, 'ignore-check');
    execFileSync('git', ['init', '--quiet', repository], options);
    prefix = [`--git-dir=${path.join(repository, '.git')}`, `--work-tree=${directory}`];
  }
  const output = execFileSync('git', [...prefix, '-c', 'core.excludesFile=/dev/null', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], options);
  return [...new Set(output.split('\0').filter(Boolean))].sort();
}

async function main() {
  const temporary = await mkdtemp(path.join(process.env.SECURITY_TMP_ROOT || tmpdir(), 'linkshot-audit-'));
  try {
    const files = await publicationFiles(root, temporary), findings = [];
    const published = path.join(temporary, 'publishable'); await mkdir(published, { recursive: true });
    let totalBytes = 0, imageMetadata = 0;
    for (const file of files) {
      const risk = publicationRisk(file); if (risk) findings.push({ file, rule: risk, line: null });
      if ((await lstat(path.join(root, file))).isSymbolicLink()) {
        findings.push({ file, rule: 'symlink-requires-publication-review', line: null });
        for (const finding of checkText(await readlink(path.join(root, file)))) findings.push({ file, ...finding });
        continue; // Never follow a project symlink into private files outside the audit scope.
      }
      const bytes = await readFile(path.join(root, file)); totalBytes += bytes.length;
      if (path.extname(file).toLowerCase() === '.png') {
        const metadata = pngMetadata(bytes); imageMetadata += metadata.length;
        for (const entry of metadata) for (const finding of checkText(entry.text)) findings.push({ file, metadata: entry.key, ...finding });
        if (metadata.length) {
          // Gitleaks skips binary images, so also scan decoded metadata as temporary text.
          const sidecar = path.join(published, `${file}.metadata.txt`);
          await mkdir(path.dirname(sidecar), { recursive: true });
          await writeFile(sidecar, metadata.map((entry) => `${entry.key}\n${entry.text}`).join('\n\n'));
        }
      } else if (!bytes.subarray(0, 8192).includes(0)) {
        for (const finding of checkText(bytes.toString('utf8'))) findings.push({ file, ...finding });
      }
      const target = path.join(published, file); await mkdir(path.dirname(target), { recursive: true }); await cp(path.join(root, file), target);
    }
    const candidates = [process.env.GITLEAKS_BINARY, path.join(root, '.toolchain/gitleaks', process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks'), 'gitleaks'].filter(Boolean);
    const scanner = candidates.find((candidate) => spawnSync(candidate, ['version'], { encoding: 'utf8' }).status === 0);
    if (scanner) {
      const report = path.join(temporary, 'gitleaks.json');
      const env = { ...process.env }; delete env.GITLEAKS_CONFIG; delete env.GITLEAKS_CONFIG_TOML;
      const result = spawnSync(scanner, ['dir', published, '--redact=100', '--ignore-gitleaks-allow', '--max-archive-depth', '2', '--report-format', 'json', '--report-path', report, '--no-banner', '--no-color'], { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      let leaks = []; try { leaks = JSON.parse(await readFile(report, 'utf8')) || []; } catch { /* No report on a scanner error. */ }
      if (result.error || result.status > 1 || (result.status !== 0 && !leaks.length)) throw new Error('Gitleaks did not complete; no clean result can be claimed.');
      for (const leak of leaks) {
        const file = path.isAbsolute(leak.File) ? path.relative(published, leak.File) : leak.File;
        findings.push({ file: file.replace(/\.png\.metadata\.txt$/, '.png'), ...(file.endsWith('.png.metadata.txt') ? { metadata: 'decoded PNG text' } : {}), rule: leak.RuleID, line: leak.StartLine });
      }
    }
    console.log(JSON.stringify({ scope: 'Git-tracked + non-ignored files (including hidden files and PNG metadata)', files: files.length, bytes: totalBytes, pngMetadataChunks: imageMetadata, scanners: scanner ? ['built-in privacy/credential rules', 'Gitleaks'] : ['built-in privacy/credential rules; install Gitleaks for additional provider rules'], findings }, null, 2));
    if (findings.length) process.exitCode = 1;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Security check could not complete. Verify Git/scanner availability and file readability. No secret values were printed.'); process.exitCode = 2; });
}
