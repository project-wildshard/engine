#!/usr/bin/env node
// One persistent, incrementally synced copy of a commit, for builds and gates that must not read the shared working
// tree. It replaces every per-run `git archive | tar -x` export.
//
// The run command is private to serve-build re-execution.
//   node scripts/build-mirror.mjs status
//
// The mirror is a work tree with its own index (GIT_INDEX_FILE), so `read-tree -u` rewrites only the files that differ
// from the commit it last held: a sync to a nearby commit writes kilobytes, never a fresh 23k-file export. It holds the
// commit minus art/, progress/ and sources/ (what the exports always excluded; --full keeps them). There is one mirror
// per slot under git-ignored ./tmp/build-mirror (G612: five pooled check slots;
// five shared slots, never per-lane slots): never /tmp, $TMPDIR or a session scratchpad (macOS empties those
// at boot, before login, and the piled-up exports stalled the boot for hours on 2026-10-15), and `du -sh tmp` shows
// what this repo holds. A lock serializes users of a slot: the mirror cannot change under a running build.
// node_modules is linked by link-node-modules.mjs (E432): @wildshard/* resolves to the mirror's own sources.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { linkNodeModules } from './link-node-modules.mjs';
import { assertHeavyLease } from './heavy-lane-lease.mjs';
import { sourceBuildId } from './app-build/buildIdentity.mjs';
import { InputHashMemo } from './bake-input-hashes.mjs';

const REPO = resolve(import.meta.dirname, '..');
const EXCLUDED = new Set(['art', 'progress', 'sources']);
const LOCK_WAIT_MS = 5 * 60_000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** G612/G670: temporary probes own no build-mirror capacity.
 * @param {string} path @param {string} [repo] */
export function scratchCaller(path, repo = REPO) {
  const absolute = existsSync(path) ? realpathSync(path) : resolve(path), local = relative(repo, absolute);
  return [local === 'tmp', local.startsWith(`tmp${sep}`), absolute === '/tmp',
    absolute === '/private/tmp', absolute.startsWith('/tmp/'), absolute.startsWith('/private/tmp/')].some(Boolean);
}

/** Refuse before queueing or creating a mirror. Inspect the script operand of
 * interpreter ancestors as well as this process, so changing cwd cannot hide a
 * temporary Python/shell/Node caller. Output directories are not caller scripts. */
export function assertMirrorCaller() {
  if (scratchCaller(process.cwd()) || process.argv[1] && scratchCaller(process.argv[1])) {
    throw new Error('G612/G670: mirrors refuse callers under tmp/; run the official preview from the checkout');
  }
  let pid = process.ppid;
  for (let depth = 0; pid > 1 && depth < 12; depth++) {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'command='], { encoding: 'utf8' });
    if (result.status !== 0) break;
    const match = /^\s*(\d+)\s+(.+)$/u.exec(result.stdout.trim());
    if (match === null) break;
    const parts = match[2].split(/\s+/u), interpreter = parts[0]?.split('/').at(-1) ?? '';
    const operand = /^(?:node|python(?:3(?:\.\d+)?)?|bash|sh|zsh)$/u.test(interpreter)
      ? parts.slice(1).find(part => !part.startsWith('-')) : undefined;
    const script = operand !== undefined && /\.(?:mjs|cjs|js|ts|py|sh)$/u.test(operand) ? operand : undefined;
    let directory;
    // Absolute script paths need no cwd lookup. Inspect the immediate caller
    // and resolve relative script operands in their actual process directory.
    if (depth === 0 || script !== undefined && !script.startsWith('/')) {
      try { directory = realpathSync(`/proc/${pid}/cwd`); }
      catch {
        const cwd = spawnSync('lsof', ['-b', '-w', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 1000 });
        directory = cwd.status === 0 ? cwd.stdout.split('\n').find(line => line.startsWith('n'))?.slice(1) : undefined;
      }
    }
    if ((depth === 0 || script !== undefined && !script.startsWith('/')) && directory === undefined) {
      throw new Error('G670: cannot verify mirror caller cwd; refusing before queueing');
    }
    if (directory !== undefined && scratchCaller(directory)) throw new Error('G612/G670: mirrors refuse a caller cwd under tmp/');
    if (script !== undefined && scratchCaller(resolve(directory ?? process.cwd(), script))) {
      throw new Error('G612/G670: mirrors refuse a caller script under tmp/; land the change and use the official preview');
    }
    pid = Number(match[1]);
  }
}

/** Only commits reachable from main are build inputs; historical main commits
 * remain available for bisects. Bare trees and unlanded commit objects refuse.
 * @param {string} rev @param {string} [repo] */
export function mainMirrorRevision(rev, repo = REPO) {
  const candidate = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd: repo, encoding: 'utf8' });
  const sha = candidate.status === 0 ? candidate.stdout.trim() : '';
  if (!sha || spawnSync('git', ['merge-base', '--is-ancestor', sha, 'refs/heads/main'], { cwd: repo }).status !== 0) {
    throw new Error(`G612: build mirrors accept only landed main commits; ${rev} is not an ancestor of main. Run types, lint and focused tests in the working tree.`);
  }
  return sha;
}

export function mirrorRoot(env = process.env, repo = REPO) {
  return resolve(env.WILDSHARD_BUILD_MIRROR ?? join(repo, 'tmp', 'build-mirror'));
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

// Waiters queue FIFO (sp-x5 waited 10+ min while newer arrivals won the mkdir race): each takes a ticket in
// `<slot>.queue/`, only the oldest live ticket may take the lock, and it polls fast so it also beats old-style waiters.
function tickets(queueDir) {
  const live = [];
  for (const name of existsSync(queueDir) ? readdirSync(queueDir).sort() : []) {
    const pid = Number(name.slice(name.lastIndexOf('-') + 1));
    if (pid && alive(pid)) live.push(name);
    else rmSync(join(queueDir, name), { force: true });
  }
  return live;
}

function holder(path, pid, slot) {
  let details;
  try { details = JSON.parse(readFileSync(path, 'utf8')); } catch { /* Older holders only recorded their PID. */ }
  const inspect = (field) => {
    try { return execFileSync('ps', ['-p', String(pid), '-o', `${field}=`], { encoding: 'utf8' }).trim(); }
    catch { return 'unavailable'; }
  };
  const started = details?.startedAt ?? (pid ? inspect('lstart') : 'unavailable');
  const elapsed = Date.now() - Date.parse(started);
  return `slot=${slot} pid=${pid === 0 ? 'unavailable' : pid} lane=${details?.lane ?? 'unknown'} age=${Number.isFinite(elapsed) ? `${Math.max(0, elapsed / 1000).toFixed(1)}s` : 'unavailable'} command=${JSON.stringify(details?.command ?? (pid ? inspect('command') : 'unavailable'))} start=${started}`;
}

function acquire(root, slots, gateDeadline) {
  const deadline = Math.min(Date.now() + LOCK_WAIT_MS, gateDeadline ?? Infinity);
  const queueDir = join(root, `${slots.length > 1 ? 'checks' : slots[0]}.queue`);
  mkdirSync(queueDir, { recursive: true });
  const ticket = `${String(Date.now()).padStart(15, '0')}-${process.pid}`;
  const details = { pid: process.pid, command: process.argv.join(' '), startedAt: new Date().toISOString(), lane: process.env.SERVE_OWNER ?? process.env.HERDR_PANE_ID ?? process.env.CLAUDE_CODE_SESSION_ID ?? process.env.CODEX_SESSION_ID ?? 'unknown' };
  writeFileSync(join(queueDir, ticket), JSON.stringify(details));
  const leave = () => { rmSync(join(queueDir, ticket), { force: true }); process.removeListener('exit', leave); };
  process.once('exit', leave);
  try { for (;;) {
    const first = tickets(queueDir)[0];
    const head = first === ticket;
    const holders = [];
    for (const slot of slots) {
      const lockDir = join(root, `${slot}.lock`);
      let owner = 0;
      try { owner = Number(readFileSync(join(lockDir, 'owner'), 'utf8')); } catch { /* Not published yet, or free. */ }
      if (owner && !alive(owner)) rmSync(lockDir, { recursive: true, force: true });
      if (head && Date.now() < deadline) {
        try {
          mkdirSync(lockDir);
          writeFileSync(join(lockDir, 'owner'), `${process.pid}\n`);
          writeFileSync(join(lockDir, 'owner.json'), JSON.stringify(details));
          leave();
          return { slot, unlock: () => rmSync(lockDir, { recursive: true, force: true }) };
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      holders.push(holder(join(lockDir, 'owner.json'), owner, slot));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const queued = !head && first ? `; queue head ${holder(join(queueDir, first), Number(first.slice(first.lastIndexOf('-') + 1)), slots.join(','))}` : '';
      throw new Error(`build-mirror: ${gateDeadline === undefined ? 'timed out after 5 min' : 'gate deadline reached'} waiting for ${slots.join(',')}; holders: ${holders.join('; ')}${queued}`);
    }
    sleep(Math.min(head ? 250 : 2000, remaining));
  } } finally { leave(); }
}

/** The commit's tree, or (unless full) a tree object of its top level without the excluded folders.
 * A shard's art/ stays: no build reads it, but the closed-component gate (G480) and check-paths do. */
function buildTree(repo, sha, full) {
  if (full) return `${sha}^{tree}`;
  const entries = execFileSync('git', ['ls-tree', '-z', sha], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0').filter((line) => line && !EXCLUDED.has(line.slice(line.indexOf('\t') + 1)));
  return execFileSync('git', ['mktree', '-z'], { cwd: repo, input: `${entries.join('\0')}\0`, encoding: 'utf8' }).trim();
}

// Admitted outputs may mix ignored JSON with unignored content-addressed blobs.
// Treat each producer's outputs as a unit across syncs, including interrupted
// generation and tracked-to-generated migrations. Never remove authored files.
function generatedGroups(dir) {
  const groups = [];
  const sourceCatalog = join(dir, 'scripts/source-generation-outputs.json');
  if (existsSync(sourceCatalog)) {
    /** @type {{producers: Record<string, string[]>}} */
    const { producers } = JSON.parse(readFileSync(sourceCatalog, 'utf8'));
    groups.push(...Object.values(producers));
  }
  return groups.map(outputs => outputs.map(file => {
    if (typeof file !== 'string' || file.startsWith('/') || file.includes('\\') || file.split('/').some(part => part === '' || part === '.' || part === '..')) throw new Error(`build-mirror: invalid generated path ${file}`);
    return file;
  }));
}

/** @param {(args: string[])=>unknown} git */
function refreshIndex(git) {
  try { git(['update-index', '-q', '--refresh']); }
  catch (error) {
    // Refresh reports 1 for genuinely changed source; other failures refuse.
    if (!(error instanceof Error && 'status' in error && error.status === 1)) throw error;
  }
}

function sourceOverlay(git, generated) {
  refreshIndex(git);
  if (git(['diff-files', '--name-only', '-z']).length > 0) return true;
  return git(['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0')
    .some(file => file && !generated.has(file) && !file.split('/').includes('node_modules'));
}

/** Lock the slot, bring its tree to `rev`, return { dir, sha, release, index } (index: the slot's git index, at `rev`). The lock also releases at process exit. */
/** Any check name requests the shared five-slot pool. No reserved slots. */
export function defaultSlot(env = process.env) {
  return env.WILDSHARD_MIRROR_SLOT ?? 'check';
}

const CHECK_SLOTS = ['check', 'check2', 'check3', 'check4', 'check5'];
const MIRROR_SLOTS = new Set(CHECK_SLOTS);

export function openMirror(rev, options = {}) {
  return prepareMirror(rev, undefined, options);
}

/** Commit checks alone may sync the wrapper's sealed candidate index into the
 * same pool. Preview/CLI admission still accepts only landed main commits.
 * @param {string} repo @param {import('./build-mirror.mjs').MirrorOptions} [options] */
export function openStagedMirror(repo, options = {}) {
  const env = options.env ?? process.env;
  const { GIT_INDEX_FILE: index, WS_COMMIT_WRAPPER: wrapper } = env;
  if (wrapper !== '1' || index === undefined || !existsSync(index)) throw new Error('Staged mirror requires commit.sh candidate index');
  const git = (/** @type {string[]} */ args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (resolve(index) === resolve(common, 'index')) throw new Error('Staged mirror refuses the shared index');
  const parent = git(['rev-parse', 'HEAD']), tree = git(['write-tree']);
  const mirror = prepareMirror(parent, tree, { ...options, repo, env });
  return { ...mirror, tree };
}

function prepareMirror(rev, candidateTree, { repo = REPO, slot = 'check', full = false, env = process.env, linkModules = true, deadline } = {}) {
  assertMirrorCaller();
  const sha = mainMirrorRevision(rev, repo);
  if (!MIRROR_SLOTS.has(slot)) throw new Error(`build-mirror: invalid slot ${slot}; use pooled check..check5`);
  // Unknown shell wrappers cannot be hoisted by heavy-lane. Refuse before queueing,
  // so an owner never waits for a mirror while consuming capacity its preview needs.
  if (env.WS_HEAVY_TOKEN) {
    /** @type {('build'|'full-test')[]} */
    const resources = ['build', 'full-test'];
    for (const resource of resources) {
      let held = false;
      try { assertHeavyLease(resource, env); held = true; } catch { /* copied/stale tokens own no capacity */ }
      if (held) throw new Error('build-mirror: acquire the mirror slot before the heavy lease; run heavy-lane inside build-mirror');
    }
  }
  if (deadline !== undefined && (!Number.isFinite(deadline) || deadline <= Date.now()))
    throw new Error('build-mirror: invalid or exhausted gate deadline before acquiring a slot');
  const admitted = acquire(mirrorRoot(env, repo), CHECK_SLOTS, deadline);
  const root = join(mirrorRoot(env, repo), admitted.slot);
  const dir = join(root, 'tree');
  // ./tmp ignores itself, so scratch there never shows up in `git status` or a commit.
  const scratchIgnore = join(repo, 'tmp', '.gitignore');
  if (existsSync(join(repo, 'tmp')) && !existsSync(scratchIgnore)) writeFileSync(scratchIgnore, '*\n');
  const unlock = admitted.unlock;
  let released = false;
  /** @type {(()=>void)|undefined} */
  let cleanup;
  const release = () => {
    if (released) return;
    released = true;
    try { cleanup?.(); } finally { unlock(); process.removeListener('exit', release); }
  };
  process.once('exit', release);
  try {
    mkdirSync(dir, { recursive: true });
    const gitEnv = { ...env, GIT_INDEX_FILE: join(root, 'index') };
    const git = (args, options = {}) => execFileSync('git', ['--work-tree', dir, ...args], { cwd: repo, env: gitEnv, maxBuffer: 1 << 28, ...options });
    const previous = generatedGroups(dir).flat();
    // Byte-identical generator rewrites must not look like source overlays.
    refreshIndex(git);
    git(['read-tree', '--reset', '-u', buildTree(repo, candidateTree ?? sha, full)]);
    refreshIndex(git);
    const drifted = git(['diff-files', '--name-only', '-z']);
    if (drifted.length > 0) git(['checkout-index', '-f', '-z', '--stdin'], { input: drifted });
    const groups = generatedGroups(dir);
    const generated = new Set(groups.flat());
    const tracked = new Set(git(['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean));
    // Retained source assets remain distinguishable from incidental generated
    // files while Git discovery is fenced outside this exact exported tree.
    const inventory = join(root, 'committed-files.json');
    writeFileSync(inventory, JSON.stringify({ root: realpathSync(dir), files: [...tracked] }));
    process.env.WS_GENERATION_TREE_FILES = inventory;
    process.env.WS_GENERATION_TREE_ROOT = realpathSync(dir);
    for (const file of previous) if (!generated.has(file) && !tracked.has(file)) rmSync(join(dir, file), { force: true });
    const strays = git(['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const stray of strays) if (!generated.has(stray) && !stray.split('/').includes('node_modules')) unlinkSync(join(dir, stray));
    const clear = outputs => { for (const file of outputs) if (!tracked.has(file)) rmSync(join(dir, file), { force: true }); };
    const hashes = new InputHashMemo(dir, join(root, 'generated-output-hashes.json'));
    const stateFile = join(root, 'generated-outputs.json');
    /** @type {Record<string,string|undefined>} */
    let accepted = {};
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (saved.schema === 1 && saved.root === realpathSync(dir) && saved.outputs !== null && typeof saved.outputs === 'object'
        && !Array.isArray(saved.outputs) && Object.values(saved.outputs).every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash))) accepted = saved.outputs;
    } catch { /* First use, legacy slots and malformed state discard unproven outputs. */ }
    const currentHash = file => {
      try { return hashes.hash(file); } catch { return undefined; }
    };
    for (const outputs of groups) if (outputs.some(file => !existsSync(join(dir, file)) || !tracked.has(file) && (accepted[file] === undefined || currentHash(file) !== accepted[file]))) clear(outputs);
    const save = () => {
      // A producer left from an interrupted owner may still remove an output
      // between presence and hashing. Such a job is unproven, never reusable.
      /** @type {Record<string,string|undefined>} */
      const outputs = {};
      for (const file of generated) if (!tracked.has(file) && existsSync(join(dir, file))) {
        const digest = currentHash(file);
        if (digest !== undefined) outputs[file] = digest;
      }
      // Outputs shared by two producers connect their invalidation. Iterate
      // until no surviving receipt points at a group cleared by another.
      /** @type {boolean} */
      let changed;
      do {
        changed = false;
        for (const group of groups) if (group.some(file => !existsSync(join(dir, file)) || !tracked.has(file) && outputs[file] === undefined)) {
          clear(group);
          for (const file of group) if (Object.hasOwn(outputs, file)) { delete outputs[file]; changed = true; }
        }
      } while (changed);
      const temporary = `${stateFile}.${process.pid}.tmp`;
      try { writeFileSync(temporary, JSON.stringify({ schema: 1, root: realpathSync(dir), outputs })); renameSync(temporary, stateFile); }
      finally { rmSync(temporary, { force: true }); hashes.flush(); }
      return outputs;
    };
    // Persist the baseline before handing over the slot, so an output-only
    // overlay is detected even if its owner dies without running release.
    save();
    // Include tracked companions so rewriting a tracked producer output also
    // invalidates that producer's untracked metadata, never unrelated jobs.
    /** @type {Record<string,string|undefined>} */
    const existing = {};
    for (const file of generated) existing[file] = currentHash(file);
    cleanup = () => {
      const dirty = sourceOverlay(git, generated);
      // Ready groups survive a source-only overlay when their own bytes stay
      // unchanged. Newly filled groups are admitted only with clean source.
      for (const outputs of groups) if (outputs.some(file => existing[file] !== undefined
        ? currentHash(file) !== existing[file]
        : dirty && currentHash(file) !== undefined)) clear(outputs);
      save();
    };
    if (linkModules) linkNodeModules(repo, dir);
    writeFileSync(join(root, 'HEAD'), `${sha}${full ? ' full' : ''}\n`);
    // git run inside the mirror must not find the checkout's .git above it (it would report the checkout's HEAD
    // and dirty status, and vite would stamp the checkout's sha): stop discovery at the slot, as a /tmp export did.
    // Children of this process inherit it; git run from the checkout itself is unaffected.
    const ceilings = (env.GIT_CEILING_DIRECTORIES ?? '').split(':').filter(Boolean);
    if (!ceilings.includes(root)) process.env.GIT_CEILING_DIRECTORIES = [...ceilings, root].join(':');
    // pins.ts reads the tracked public files from this index (tracked-public.mjs): the slot has no .git of its own
    return { dir, sha, release, index: join(root, 'index') };
  } catch (error) {
    release();
    throw error;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === import.meta.filename;
if (isMain) {
  const args = process.argv.slice(2);
  const dash = args.indexOf('--');
  const head = dash === -1 ? args : args.slice(0, dash);
  const command = dash === -1 ? [] : args.slice(dash + 1);
  const slotAt = head.indexOf('--slot');
  const slot = slotAt === -1 ? defaultSlot() : head[slotAt + 1];
  const full = head.includes('--full');
  const [action, rev = 'HEAD'] = head.filter((a, i) => a !== '--full' && (slotAt === -1 || (i !== slotAt && i !== slotAt + 1)));
  if (action === 'status') {
    const root = mirrorRoot();
    console.info(root);
    for (const name of existsSync(root) ? readdirSync(root).filter((n) => !n.endsWith('.lock') && !n.endsWith('.queue')) : []) {
      const at = existsSync(join(root, name, 'HEAD')) ? readFileSync(join(root, name, 'HEAD'), 'utf8').trim() : '-';
      console.info(`${name}\t${at}\t${existsSync(join(root, `${name}.lock`)) ? 'locked' : 'free'}`);
    }
  } else if (action === 'authorize') {
    assertMirrorCaller();
    console.info(mainMirrorRevision(rev));
  } else if (action === 'run') {
    assertMirrorCaller();
    if (command[0] !== 'bash' || command[1] !== resolve(REPO, 'scripts/serve-build.sh')) {
      throw new Error('G612: build-mirror run is reserved for serve-build re-execution; use types, lint and focused tests in the working tree');
    }
    mainMirrorRevision(rev);
    const { dir, sha, release, index } = openMirror(rev, { slot, full });
    const result = spawnSync(command[0], command.slice(1), { cwd: dir, stdio: 'inherit', env: { ...process.env, WS_BUILD_ID: sourceBuildId(sha), WS_MIRROR_REPO: REPO, WS_MIRROR_INDEX: index } });
    release();
    process.exit(result.status ?? 1);
  } else {
    console.error('usage: build-mirror.mjs status | authorize <main-rev>; run is private to serve-build');
    process.exit(2);
  }
}
