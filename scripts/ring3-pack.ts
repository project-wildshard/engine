// QA-FEEDBACK-2026-11-23-b row 40 (J505): Ring 3's receivers install the candidate as `github:project-wildshard/engine#<sha>`,
// a Git source archive. The boot stamps and every other `*.generated.*` the build writes are ignored by Git, so that archive
// lacked them and Dunes' and Nalati's shard builds failed, while npm (scripts/npm-artifact.mjs) ships them. The sender now
// builds the npm archive the same way, then commits each file that archive holds and Git does not track onto the candidate,
// as `ring3/<engine>`: the receivers install that commit, which carries what npm carries. It refuses to send a commit that
// lacks any `*.generated.*` the npm archive has.
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/** A path inside the npm archive (`package/` stripped), or null for the bundled `node_modules` (npm-artifact adds them; a
 *  Git install resolves them from the candidate's own package.json). */
export function packagePath(entry: string): string | null {
  const path = entry.replace(/^package\//u, '');
  if (path === '' || path.endsWith('/') || path === entry || path.startsWith('node_modules/')) return null;
  return path;
}

/** The archive's files Git does not track at the candidate: what the Ring 3 commit adds. package.json is the candidate's own. */
export function untracked(archive: readonly string[], tracked: ReadonlySet<string>): string[] {
  return archive.flatMap(entry => { const path = packagePath(entry); return path === null || path === 'package.json' || tracked.has(path) ? [] : [path]; });
}

/** Every generated file the npm archive carries that the Ring 3 commit's tree lacks: the guard (empty is green). */
export function missingGenerated(archive: readonly string[], tree: ReadonlySet<string>): string[] {
  return archive.flatMap(entry => { const path = packagePath(entry); return path !== null && /\.generated\./u.test(path) && !tree.has(path) ? [path] : []; });
}

const git = (...args: string[]): string => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});

/** Commit the npm archive's untracked files onto the checked-out candidate; returns the commit, after the guard passes. */
export function packCommit(engine: string, tarball: string): string {
  if (!/^[a-f0-9]{40}$/u.test(engine)) throw new Error('Ring 3 packs the full engine commit hash');
  if (git('rev-parse', 'HEAD').trim() !== engine) throw new Error('Ring 3 packs from a checkout of the candidate itself');
  const archive = execFileSync('tar', ['-tzf', tarball], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\n').filter(Boolean);
  const tracked = new Set(git('ls-files', '-z').split('\0').filter(Boolean));
  const adds = untracked(archive, tracked);
  const absent = adds.filter(path => !existsSync(path));
  if (absent.length > 0) throw new Error(`The npm archive holds files this checkout lacks: ${absent.slice(0, 10).join(', ')}`);
  for (let at = 0; at < adds.length; at += 500) git('add', '--force', '--', ...adds.slice(at, at + 500));
  git('-c', 'user.name=ring-3', '-c', 'user.email=ring-3@users.noreply.github.com', 'commit', '--quiet', '--no-verify', '--allow-empty',
    '-m', `ring 3: ${engine} with its npm archive's build outputs`);
  const packed = git('rev-parse', 'HEAD').trim();
  const missing = missingGenerated(archive, new Set(git('ls-tree', '-r', '--name-only', '-z', packed).split('\0').filter(Boolean)));
  if (missing.length > 0) throw new Error(`The Ring 3 commit lacks generated files the npm archive has: ${missing.join(', ')}`);
  return packed;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [engine = '', artifact = 'tmp/ring3/npm.json'] = process.argv.slice(2);
  const {filename} = JSON.parse(readFileSync(artifact, 'utf8')) as {filename: string};
  console.log(packCommit(engine, filename));
}
