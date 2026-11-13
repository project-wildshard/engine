// A format bump moves every workspace manifest, the lock's importers and its one package row together. pnpm refuses
// the store at install when the row's version isn't the commit's own (6006c59074, e7b2341d61) and an old pnpm locks an
// annotated tag's object rather than its commit (383f470d39), and either way every CI job stops at install.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK = 'pnpm-lock.yaml';
// J308: the shardfile repo and package became shard-format. Every manifest keeps the `@wildshard/format` alias (the
// imports name it); the lock's package row and the tag's package.json carry the real name.
const FORMAT = '@wildshard/format';
const PACKAGE = '@wildshard/shard-format';
const PIN = /^github:project-wildshard\/shard-format#(v\d+\.\d+\.\d+)$/u;
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const FETCH_MS = 8000;

/** The push reads these, so a push that touches none of them can't be refused for a state it didn't cause.
 * @param {string} path */
export const isFormatLockInput = path => path === LOCK || /(?:^|\/)package\.json$/u.test(path) || /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path);

/** @param {string} text */
function parseLock(text) {
  const importers = new Map();
  const start = text.indexOf('\nimporters:\n'), end = text.indexOf('\npackages:\n');
  const block = start === -1 || end === -1 ? '' : text.slice(start, end), keys = [...block.matchAll(/^ {2}(\S+):$/gmu)];
  keys.forEach((key, index) => {
    const body = block.slice(key.index, keys[index + 1]?.index);
    // pnpm locks a github pin as git (`git+ssh://…#<commit>`) or as a codeload tarball (`…/tar.gz/<commit>`)
    const row = /^ {6}'@wildshard\/format':\n {8}specifier: (\S+)\n {8}version: \S*?(?:#|\/tar\.gz\/)([0-9a-f]{40})/mu.exec(body);
    if (row !== null) importers.set(key[1], { specifier: row[1], commit: row[2] });
  });
  const rows = [...text.matchAll(/^ {2}'@wildshard\/shard-format@[^']*':\n {4}resolution: \{([^}\n]*)\}\n(?: {4}version: (\S+)\n)?/gmu)]
    .map(row => {
      const git = /^commit: ([0-9a-f]{40}), repo: ([^,]+), type: git$/u.exec(row[1] ?? '');
      if (git !== null) return { commit: git[1], repo: git[2], version: row[2] };
      const tarball = /tarball: https:\/\/codeload\.github\.com\/([\w.-]+\/[\w.-]+)\/tar\.gz\/([0-9a-f]{40})$/u.exec(row[1] ?? '');
      return { commit: tarball?.[2], repo: tarball === null ? undefined : `https://github.com/${tarball[1]}.git`, version: row[2] };
    });
  return { importers, keys: keys.map(key => key[1]), rows };
}

/** Everything that needs no network: the pins agree, and the lock row is the release they name.
 * @param {(path: string) => string | undefined} read @param {readonly string[]} workflows */
export function formatLockFailures(read, workflows = []) {
  const failures = [], text = read(LOCK);
  if (text === undefined) return failures;
  const { importers, keys, rows } = parseLock(text);
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) return [`${LOCK}: expected one ${PACKAGE} package row, found ${rows.length}`];
  if (row.commit === undefined) return [`${LOCK}: ${PACKAGE} row's resolution is neither a git commit nor a codeload tarball`];
  const pins = new Set();
  for (const key of keys) {
    const file = key === '.' ? 'package.json' : `${key}/package.json`, manifest = read(file);
    if (manifest === undefined) { failures.push(`${LOCK}: importer ${key} has no ${file}`); continue; }
    const parsed = JSON.parse(manifest), pin = SECTIONS.map(section => parsed[section]?.[FORMAT]).find(value => value !== undefined);
    const locked = importers.get(key);
    if (pin === undefined) {
      if (locked !== undefined) failures.push(`${LOCK}: importer ${key} locks ${FORMAT} but ${file} doesn't name it`);
      continue;
    }
    if (!PIN.test(pin)) failures.push(`${file}: ${FORMAT} pin ${pin} isn't a shard-format release tag`);
    pins.add(pin);
    if (locked?.specifier !== pin) failures.push(`${file}: ${FORMAT} pin ${pin} but ${LOCK} has ${locked?.specifier ?? 'no row'}`);
    else if (locked.commit !== row.commit) failures.push(`${LOCK}: importer ${key} locks ${locked.commit}, its package row ${row.commit}`);
  }
  if (pins.size > 1) failures.push(`package.json: ${FORMAT} pins disagree: ${[...pins].join(', ')}`);
  const tag = pins.size === 1 ? PIN.exec([...pins][0] ?? '')?.[1] : undefined;
  if (tag !== undefined && row.version !== tag.slice(1)) {
    failures.push(`${LOCK}: ${FORMAT} row says version ${row.version ?? '(none)'}, the pin says ${tag}: pnpm will refuse the store. Rerun the bump with pnpm 10.34.9 or newer`);
  }
  // pnpm/action-setup throws when its version and packageManager differ, so a half-done bump also stops every job.
  const manager = JSON.parse(read('package.json') ?? '{}').packageManager;
  const wanted = typeof manager === 'string' ? manager.replace(/^pnpm@/u, '') : undefined;
  for (const file of workflows) {
    if (wanted === undefined) break;
    for (const step of (read(file) ?? '').matchAll(/pnpm\/action-setup@\S+[\s\S]*?[{\s]version: ([^\s,}]+)/gu)) {
      if (step[1] !== wanted) failures.push(`package.json: packageManager says ${wanted}, ${file} sets up pnpm ${step[1]}`);
    }
  }
  return failures;
}

/** @param {string} repo @param {string} tag @returns {{commit: string, name: string, version: string}} */
function readTagFromRemote(repo, tag) {
  const folder = mkdtempSync(join(tmpdir(), 'format-tag-'));
  const deadline = Number(process.env.WS_GIT_CHECK_DEADLINE ?? Number.POSITIVE_INFINITY);
  const timeout = Math.max(1, Math.min(FETCH_MS, deadline - Date.now()));
  const git = (/** @type {string[]} */ ...args) => execFileSync('git', [`--git-dir=${folder}`, ...args],
    { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
  try {
    git('init', '-q', '--bare');
    git('fetch', '-q', '--depth=1', '--filter=blob:none', repo, `refs/tags/${tag}`);
    const { name, version } = JSON.parse(git('show', 'FETCH_HEAD:package.json'));
    return { commit: git('rev-parse', 'FETCH_HEAD^{commit}'), name, version };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

/** The tag is the truth, and only the network has it. An unreadable tag isn't a refusal: CI's frozen install decides.
 * @param {(path: string) => string | undefined} read
 * @param {(repo: string, tag: string) => {commit: string, name: string, version: string}} [readTag] */
export function formatTagFailures(read, readTag = readTagFromRemote) {
  const text = read(LOCK), root = read('package.json');
  if (text === undefined || root === undefined) return [];
  const row = parseLock(text).rows[0], parsed = JSON.parse(root);
  const pin = SECTIONS.map(section => parsed[section]?.[FORMAT]).find(value => value !== undefined);
  const tag = typeof pin === 'string' ? PIN.exec(pin)?.[1] : undefined;
  if (row?.repo === undefined || tag === undefined) return [];
  let facts;
  try { facts = readTag(row.repo, tag); }
  catch (error) {
    console.log(`format-lock: ${tag} unread, CI's frozen install decides (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`);
    return [];
  }
  const failures = [];
  if (facts.commit !== row.commit) failures.push(`${LOCK}: ${FORMAT} row locks ${row.commit}, ${tag} is commit ${facts.commit}`);
  if (facts.name !== PACKAGE) failures.push(`${LOCK}: ${tag}'s package.json names ${facts.name}, not ${PACKAGE}`);
  if (facts.version !== row.version) failures.push(`${LOCK}: ${FORMAT} row says version ${row.version ?? '(none)'}, ${tag}'s package.json says ${facts.version}`);
  return failures;
}
