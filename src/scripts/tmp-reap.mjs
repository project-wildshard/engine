import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DAY = 24 * 60 * 60 * 1000;

/** @param {string} path @param {string} root */
const under = (path, root) => path === root || path.startsWith(`${root}${sep}`);

/** Includes file descriptors and cwd, even for a caller working outside tmp. Fail closed on an incomplete table. */
export function openTmpPaths() {
  const listing = spawnSync('lsof', ['-nP', '-w', '-Fn'], { cwd: '/', encoding: 'utf8', timeout: 15_000, maxBuffer: 64 << 20 });
  if (listing.status !== 0 || !listing.stdout) return undefined;
  return listing.stdout.split('\n').filter(line => line.startsWith('n/')).map(line => line.slice(1));
}

/** @param {string} dir */
function ownsGit(dir) {
  return existsSync(join(dir, '.git')) ||
    ['HEAD', 'objects', 'refs'].every(name => existsSync(join(dir, name)));
}

/** @param {string} root @param {number} cutoff @param {number} device */
function idleTree(root, cutoff, device) {
  const remaining = [root];
  while (remaining.length > 0) {
    const path = remaining.pop();
    if (path === undefined) break;
    let info;
    try { info = lstatSync(path); } catch { return false; }
    if (info.dev !== device || info.mtimeMs > cutoff) return false;
    if (!info.isDirectory()) continue;
    let entries;
    try { entries = readdirSync(path); } catch { return false; }
    if (entries.includes('.keep') || entries.includes('.git') ||
        ['HEAD', 'objects', 'refs'].every(name => entries.includes(name))) return false;
    for (const name of entries) remaining.push(join(path, name));
  }
  return true;
}

/** @param {string} tmp */
function keptPaths(tmp) {
  try { return new Set(readFileSync(join(tmp, 'keep'), 'utf8').split('\n').map(line => (line.split('#')[0] ?? '').trim()).filter(Boolean)); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return new Set();
    if (lstatSync(join(tmp, 'keep')).isDirectory()) return new Set(['keep']);
    throw error;
  }
}

/** @param {string} tmp @param {string} dir @param {Set<string>} keep */
function candidates(tmp, dir, keep) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'keep')
    .map(entry => join(dir, entry.name)).filter(path => !keep.has(relative(tmp, path)) && !existsSync(join(path, '.keep')) && !ownsGit(path));
}

/** @param {string} canonical @param {{dryRun:boolean}} options @param {(message:string)=>void} say
 * @param {{now?:number,openPaths?:()=>string[]|undefined}} [proof] */
export function reapTmp(canonical, options, say, {now = Date.now(), openPaths = openTmpPaths} = {}) {
  const path = join(canonical, 'tmp');
  if (!existsSync(path)) return;
  const tmp = realpathSync(path), info = lstatSync(path);
  if (!info.isDirectory() || tmp !== join(realpathSync(canonical), 'tmp')) throw new Error('Refusing a non-directory or redirected tmp');
  const keep = keptPaths(tmp);
  const busy = openPaths();
  if (busy === undefined) { say('kept tmp: open files could not be listed'); return; }
  const cutoff = now - DAY;
  const idle = (/** @type {string} */ candidate) => !busy.some(file => under(file, candidate)) &&
    ![...keep].some(name => under(join(tmp, name), candidate)) && idleTree(candidate, cutoff, info.dev);
  const eligible = candidates(tmp, tmp, keep).flatMap(lane => idle(lane) ? [lane] : candidates(tmp, lane, keep).filter(idle));
  for (const candidate of eligible) {
    if (!options.dryRun) {
      if (!idleTree(candidate, cutoff, info.dev)) continue;
      const latest = openPaths();
      if (latest === undefined) { say('kept remaining tmp: open files could not be rechecked'); return; }
      if (latest.some(file => under(file, candidate))) continue;
      rmSync(candidate, { recursive: true, force: true });
    }
    say(`${options.dryRun ? 'would reap' : 'reaped'} tmp/${relative(tmp, candidate)}: idle 24h, no git or open files`);
  }
}
