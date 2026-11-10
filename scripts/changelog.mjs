// The engine changelog (CHANGELOG.md; Jake, 2026-11-10: every version tag, patches included, carries one): parse it,
// check it, and pick the section the title screen's WHAT'S NEW box shows (vite.config.ts `__ENGINE_RELEASE__`).
//   node scripts/changelog.mjs check                 package.json's version has a valid section (pre-push, CI)
//   node scripts/changelog.mjs check vX.Y.Z [--at=<rev>]   the tag's version, read from that commit
//   node scripts/changelog.mjs refs < <ref lines>   .githooks/pre-push: a pushed main or vX.Y.Z tag must carry its section
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHANGELOG_PATH = 'CHANGELOG.md';
export const MAX_NOTES = 5;
const HEADING = /^## v(\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/u;
const HOW = `Fix: add "## vX.Y.Z (YYYY-MM-DD)" at the top of ${CHANGELOG_PATH} with 1 to ${MAX_NOTES} "- " bullets in plain language, for players and Jake.`;

/** @typedef {{ version: string, date: string, notes: string[] }} Release */

/** @param {string} a @param {string} b */
const compare = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]); };

/** Why a bullet reads like a commit subject or a file, not a line for players; null when it is fine.
 * @param {string} note */
export function noteProblem(note) {
  if (note.length < 12) return 'is too short to say what changed';
  if (note.length > 140) return 'is over 140 characters';
  if (/^[a-z]+(\([^)]*\))?!?:/u.test(note)) return 'is a commit subject (type(scope): …)';
  if (/\b[0-9a-f]{7,40}\b/u.test(note)) return 'names a commit hash';
  if (/`|\b[\w-]+\/[\w./-]+\.\w+\b|\.(?:ts|mjs|js|json|css)\b/u.test(note)) return 'names code or a file';
  return null;
}

/** Every section in file order, and what is wrong with the file.
 * @param {string} text @returns {{ releases: Release[], problems: string[] }} */
export function parseChangelog(text) {
  /** @type {Release[]} */
  const releases = [];
  const problems = [];
  /** @type {Release | null} */
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      const m = HEADING.exec(line.trimEnd());
      if (m === null) { problems.push(`"${line}" is not "## vX.Y.Z (YYYY-MM-DD)"`); current = null; continue; }
      current = { version: m[1] ?? '', date: m[2] ?? '', notes: [] };
      releases.push(current);
    } else if (current !== null && line.startsWith('- ')) current.notes.push(line.slice(2).trim());
    else if (current !== null && line.trim() !== '') problems.push(`v${current.version}: "${line.trim()}" is not a "- " bullet`);
  }
  for (const [i, release] of releases.entries()) {
    const next = releases[i + 1];
    if (next !== undefined && compare(release.version, next.version) <= 0) problems.push(`v${release.version} is above v${next.version}: newest first, each version once`);
    if (release.notes.length === 0 || release.notes.length > MAX_NOTES) problems.push(`v${release.version} has ${release.notes.length} bullets, not 1 to ${MAX_NOTES}`);
    for (const note of release.notes) { const problem = noteProblem(note); if (problem !== null) problems.push(`v${release.version}: "${note}" ${problem}`); }
  }
  return { releases, problems };
}

/** What stops `version` shipping with this changelog: a malformed file, no section for it, or more than one unreleased
 *  section above it (the next version's section lands before release.sh bumps package.json).
 * @param {string} text @param {string} version @returns {string[]} */
export function releaseProblems(text, version) {
  const { releases, problems } = parseChangelog(text);
  const at = releases.findIndex(release => release.version === version);
  if (at === -1) problems.push(`${CHANGELOG_PATH} has no section for v${version}`);
  else if (at > 1) problems.push(`${CHANGELOG_PATH} has ${at} sections above v${version}; only the next version's may come first`);
  return problems;
}

/** The section a build of this tree shows: package.json's version and its notes ('' and none when missing; the gates refuse
 *  that before it can ship).
 * @param {string} root @returns {Release} */
export function engineRelease(root) {
  const { version } = /** @type {{ version: string }} */ (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
  let text = '';
  try { text = readFileSync(join(root, CHANGELOG_PATH), 'utf8'); } catch { /* an old tree: version only */ }
  const found = parseChangelog(text).releases.find(release => release.version === version);
  return { version, date: found?.date ?? '', notes: found?.notes ?? [] };
}

/** The problems at a commit (a pushed ref) for its package.json version, or for `tag`'s version, which must also be the
 *  commit's package.json version (release.sh tags a prepared commit or a published descendant of it).
 * @param {string} rev @param {string} [tag] @param {string} [cwd] @returns {string[]} */
export function problemsAt(rev, tag, cwd = process.cwd()) {
  const show = (/** @type {string} */ path) => execFileSync('git', ['show', `${rev}:${path}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let version;
  try { version = /** @type {{ version: string }} */ (JSON.parse(show('package.json'))).version; } catch { return [`no package.json at ${rev}`]; }
  let text = '';
  try { text = show(CHANGELOG_PATH); } catch { return [`no ${CHANGELOG_PATH} at ${rev}`]; }
  if (tag === undefined) return releaseProblems(text, version);
  const wanted = /^v(\d+\.\d+\.\d+)$/u.exec(tag)?.[1];
  if (wanted === undefined) return [`${tag} is not vX.Y.Z`];
  const problems = releaseProblems(text, wanted);
  if (version !== wanted) problems.push(`${tag} points at package.json version ${version}; prepare it with release.sh first`);
  return problems;
}

/** The pre-push hook's check: git's ref lines (`<local ref> <local sha> <remote ref> <remote sha>`). A pushed main must
 *  carry its package.json version's section, a pushed `vX.Y.Z` tag that version's; deletes and other refs pass.
 * @param {string} lines @param {string} [cwd] @returns {string[]} */
export function pushProblems(lines, cwd = process.cwd()) {
  return lines.split('\n').filter(Boolean).flatMap(line => {
    const [, local = '', remote = ''] = line.split(' ');
    if (/^0+$/u.test(local)) return [];
    const tag = /^refs\/tags\/(v\d+\.\d+\.\d+)$/u.exec(remote)?.[1];
    if (tag !== undefined) return problemsAt(`${local}^{commit}`, tag, cwd).map(p => `${tag}: ${p}`);
    return remote === 'refs/heads/main' ? problemsAt(local, undefined, cwd).map(p => `main: ${p}`) : [];
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, tag] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (mode !== 'check' && mode !== 'refs') { console.error('usage: changelog.mjs check [vX.Y.Z] [--at=<rev>] | refs < <pre-push ref lines>'); process.exit(2); }
  const at = process.argv.find(arg => arg.startsWith('--at='))?.slice(5);
  const problems = mode === 'refs' ? pushProblems(readFileSync(0, 'utf8'))
    : at === undefined && tag === undefined ? releaseProblems(readFileSync(CHANGELOG_PATH, 'utf8'), engineRelease(process.cwd()).version)
    : problemsAt(at ?? 'HEAD', tag);
  if (problems.length > 0) { console.error(`push blocked: the engine changelog\n${problems.map(p => `  - ${p}`).join('\n')}\n${HOW}`); process.exit(1); }
  if (mode !== 'refs') console.log(`changelog: ${tag ?? `v${engineRelease(process.cwd()).version}`} ok`);
}
