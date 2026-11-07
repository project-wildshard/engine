#!/usr/bin/env node
// repo-size.mjs — the storage policy (docs/process/STORAGE.md) applied to real Git objects, never the working tree.
//
//   node scripts/repo-size.mjs --index                     the proposed commit (honours GIT_INDEX_FILE), with the
//                                                          unpushed commits' and the rolling week's budgets
//   node scripts/repo-size.mjs --tree <rev> [--strict]     every path in <rev>; --strict drops the legacy allowance
//   node scripts/repo-size.mjs --pre-push [--range-only]   git's pre-push records on stdin: every outgoing commit;
//                                                          --range-only (CI) skips the rolling week
//
// scripts/storage-policy.json holds the reviewed data (caps, migrationBase, exact pins); the ceilings below bound it,
// so a policy edit can tighten a cap but never loosen one. Changed path/blob pairs face the rules; while migrationBase
// is set, the pairs already in that commit are legacy debt that may stay unchanged or leave, never return.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

const MB = 1_000_000;
const POLICY = 'scripts/storage-policy.json';
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const ZERO = /^0+$/u;
/** The policy may lower these, never raise them. */
const CEILINGS = { maxBlobBytes: MB, maxJsonBlobBytes: 5 * MB, maxPreviewBytes: 250_000, maxBoardBytes: 500_000, maxPushBytes: 10 * MB, maxWeeklyBytes: 100 * MB };
/** Shipped bytes: the website, the native app resources and each shard's content-addressed runtime assets. */
const RUNTIME_ROOTS = ['public/', 'android/app/src/main/res/', 'ios/App/App/Assets.xcassets/'];
const SHARD_ASSETS = /^src\/shards\/[^/]+\/assets\//u;
const GENERATED = /(?:^|\/)(?:node_modules|dist|dist-[^/]+|\.native-build|\.wildshard|\.tsc-layers|boot-smoke-results|scratchpad|tmp|media-cache)(?:\/|$)|(?:^|\/)\.claude\/worktrees(?:\/|$)/u;
const NESTED_GIT = /(?:^|\/)\.git(?:\/|$)/u;
const FORBIDDEN = /\.(?:mp4|m4v|mov|webm|mkv|avi|gif|mp3|m4a|wav|ogg|opus|flac|aac|aiff|zip|gz|tgz|br|zst|xz|bz2|7z|rar|tar|jsonl|pdf|blend\d*)$|\.heap\.json$/iu;
const PICTURE = /\.(?:png|jpe?g|webp|avif)$/iu;
const BOARD = /(?:board|sheet|contact)[^/]*$/iu;
/** A bare sha256 name is a content-addressed binary (shard assets, shardfile fixtures); other bare names are text. */
const CONTENT_ADDRESSED = /^[0-9a-f]{64}$/u;
const TEXT = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'json5', 'jsonc', 'md', 'mdx', 'txt', 'css',
  'html', 'htm', 'svg', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'csv', 'tsv', 'xml', 'py', 'sh', 'bash', 'zsh', 'swift',
  'kt', 'java', 'gradle', 'properties', 'plist', 'pbxproj', 'xcconfig', 'entitlements', 'storyboard', 'xib', 'glsl', 'wgsl',
  'vert', 'frag', 'as', 'lock', 'log', 'tex', 'gitignore', 'gitattributes', 'npmrc', 'nvmrc', 'editorconfig', 'env']);

/**
 * @typedef {{ maxBlobBytes: number, maxJsonBlobBytes: number, maxPreviewBytes: number, maxBoardBytes: number, maxPushBytes: number,
 *   maxWeeklyBytes: number, migrationBase: string | null, pins: Map<string, Pin> }} Policy
 * @typedef {{ path: string, oid: string, bytes: number, kind: 'runtime' | 'input', purpose: string }} Pin
 * @typedef {{ mode: string, oid: string, oldMode: string, oldOid: string, status: string, path: string }} Change
 * @typedef {{ oid: string, parents: string[] }} Commit
 * @typedef {{ oid: string, path: string }} Added
 * @typedef {{ cwd?: string, env?: NodeJS.ProcessEnv, now?: () => number }} CheckerOptions
 */

/** @param {string} path */
export function isRuntime(path) {
  return RUNTIME_ROOTS.some((root) => path.startsWith(root)) || SHARD_ASSETS.test(path);
}

/** @param {string} path A text name: Git deltas these, so they are capped per blob but not counted in the budgets. */
export function isText(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return !CONTENT_ADDRESSED.test(base);
  return TEXT.has(base.slice(dot + 1).toLowerCase());
}

/** @param {string} path Binary bytes outside the runtime roots: what the per-push and weekly budgets count. */
export function isCounted(path) {
  return !isRuntime(path) && !isText(path);
}

/** @param {number} bytes */
const mb = (bytes) => `${(bytes / MB).toFixed(2)} MB`;

/** @param {string} path @param {Buffer} data */
function disguised(path, data) {
  if (isText(path)) return data.subarray(0, 8000).includes(0) ? 'binary content behind a text name' : null;
  const hex = data.subarray(0, 8).toString('hex');
  const head = data.subarray(0, 12).toString('latin1');
  const brand = head.slice(8, 12);
  if (/^(?:504b0304|1f8b|fd377a585a00|377abcaf271c|526172211a07|28b52ffd|425a68|934e554d5059|25504446|1a45dfa3)/u.test(hex)) {
    return 'archive / PDF / video signature';
  }
  if (/^(?:BLENDER|OggS|fLaC|ID3|GIF8)/u.test(head) || (head.startsWith('RIFF') && brand !== 'WEBP') ||
    (head.slice(4, 8) === 'ftyp' && !/^(?:avi[fs]|hei[cx]|mif1|msf1)$/u.test(brand))) {
    return 'media signature';
  }
  return null;
}

/** @param {string} path */
function forbiddenHint(path) {
  if (/\.blend\d*$/iu.test(path)) return 'a .blend is never committed: the Blender script is the source, commit its GLB (scripts/blender/build.sh)';
  if (/\.(?:gz|br|zst|jsonl)$|\.heap\.json$/iu.test(path)) return 'raw soak / census / receipt archives and logs stay in scratch; commit the summary and the numbers';
  if (/\.pdf$/iu.test(path)) return 'PDFs stay out of Git; link the source page or keep the PDF outside the repo';
  return 'video / audio / archives stay outside Git (scratch now, the media store once REPO-WEIGHT RW3 lands)';
}

/** @param {unknown} value @param {(policy: string) => boolean} known */
function parsePolicy(value, known) {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 1 ||
    !('pins' in value) || !Array.isArray(value.pins)) {
    throw new Error(`${POLICY}: schemaVersion 1 with a pins array required`);
  }
  /** @type {Record<string, unknown>} */
  const fields = { ...value };
  /** @param {keyof typeof CEILINGS} key @returns {number} */
  const cap = (key) => {
    const given = fields[key];
    if (typeof given !== 'number' || !Number.isSafeInteger(given) || given < 1 || given > CEILINGS[key]) {
      throw new Error(`${POLICY}: ${key} must be an integer from 1 to ${CEILINGS[key]}`);
    }
    return given;
  };
  // JSON gets its own, larger blob cap (Jake, 2026-10-16); a policy without it uses the plain blob cap.
  const blob = cap('maxBlobBytes');
  const caps = { maxBlobBytes: blob, maxJsonBlobBytes: fields.maxJsonBlobBytes === undefined ? blob : cap('maxJsonBlobBytes'), maxPreviewBytes: cap('maxPreviewBytes'), maxBoardBytes: cap('maxBoardBytes'),
    maxPushBytes: cap('maxPushBytes'), maxWeeklyBytes: cap('maxWeeklyBytes') };
  const base = fields.migrationBase;
  if (base !== undefined && (typeof base !== 'string' || !OID.test(base))) throw new Error(`${POLICY}: migrationBase must be a full commit id`);
  if (typeof base === 'string' && !known(base)) {
    throw new Error(`${POLICY}: migrationBase ${base} is not in this repository; fetch it, or drop it only when the strict tree check passes`);
  }
  /** @type {Map<string, Pin>} */
  const pins = new Map();
  for (const pin of /** @type {unknown[]} */ (value.pins)) {
    const item = /** @type {Partial<Pin>} */ (typeof pin === 'object' && pin !== null ? pin : {});
    const { path, oid, bytes, kind, purpose } = item;
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..') || typeof oid !== 'string' ||
      !OID.test(oid) || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0 ||
      (kind !== 'runtime' && kind !== 'input') || typeof purpose !== 'string' || !purpose.trim() || pins.has(path)) {
      throw new Error(`${POLICY}: each pin needs a unique path, its blob oid, bytes, kind runtime|input and a purpose (${JSON.stringify(pin)})`);
    }
    if (GENERATED.test(path) || NESTED_GIT.test(path)) throw new Error(`${POLICY}: ${path}: generated paths cannot be pinned`);
    if (kind === 'runtime' && !isRuntime(path)) throw new Error(`${POLICY}: ${path}: a runtime pin must be under ${RUNTIME_ROOTS.join(', ')} or src/shards/<slug>/assets/`);
    if (kind === 'input' && isRuntime(path)) throw new Error(`${POLICY}: ${path}: shipped files take kind runtime`);
    if (kind === 'input' && FORBIDDEN.test(path) && !path.startsWith('test/fixtures/')) throw new Error(`${POLICY}: ${path}: only test/fixtures/ may pin media or archives`);
    pins.set(path, { path, oid, bytes, kind, purpose });
  }
  return { ...caps, migrationBase: typeof base === 'string' ? base : null, pins };
}

/** @param {CheckerOptions} [options] */
export function createChecker({ cwd = process.cwd(), env = process.env, now = Date.now } = {}) {
  // Existence probes and size reads must never trigger one lazy fetch per object in a partial clone; prefetch() batches.
  const gitEnv = { ...env, GIT_NO_LAZY_FETCH: '1' };
  /** @param {string[]} args @param {string} [input] */
  const git = (args, input) => execFileSync('git', args, { cwd, env: gitEnv, input, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
  /** @param {string[]} args @param {string} [input] */
  const lines = (args, input) => git(args, input).split('\n').filter(Boolean);
  /** @param {string} rev */
  const exists = (rev) => {
    try { git(['cat-file', '-e', rev]); return true; } catch { return false; }
  };
  const emptyTree = git(['hash-object', '-t', 'tree', '--stdin'], '').trim();

  /** @type {Map<string, Policy>} */
  const policies = new Map();
  /** @param {string} spec */
  function blobAt(spec) {
    try { return git(['rev-parse', '--verify', '--quiet', spec]).trim(); } catch { throw new Error(`${spec}: storage policy missing`); }
  }
  /** @param {string} spec `<commit>:<path>` or `:<path>` (the index) */
  function policyAt(spec) {
    const oid = blobAt(spec);
    const cached = policies.get(oid);
    if (cached) return cached;
    prefetch([oid]);
    const policy = parsePolicy(JSON.parse(git(['cat-file', 'blob', oid])), (base) => exists(`${base}^{commit}`));
    policies.set(oid, policy);
    return policy;
  }

  /** @param {string} rev Existence of the tree entry, even before a partial clone fetches its blob. */
  const hasPolicy = (rev) => {
    try { git(['rev-parse', '--verify', '--quiet', `${rev}:${POLICY}`]); return true; } catch { return false; }
  };

  /** @type {Map<string, Set<string>>} */
  const treeOids = new Map();
  /** @param {string} rev Every blob id in a tree (trees only: no blob is read, so a blobless clone can answer). */
  function blobsIn(rev) {
    let set = treeOids.get(rev);
    if (!set) {
      set = new Set(git(['ls-tree', '-r', '-z', rev]).split('\0').filter(Boolean).map((row) => row.split(/\s+/u)[2] ?? ''));
      treeOids.set(rev, set);
    }
    return set;
  }

  /** @param {string} raw `--raw -z` output @returns {Map<string, Change[]>} keyed by the commit line before each block */
  function parseRaw(raw, first = '') {
    /** @type {Map<string, Change[]>} */
    const out = new Map();
    let current = first;
    const parts = raw.split('\0');
    for (let index = 0; index < parts.length; index++) {
      const part = (parts[index] ?? '').replace(/^\n+/u, '');
      if (!part) continue;
      if (!part.startsWith(':')) { current = part.split(/\s/u)[0] ?? ''; continue; }
      const [oldMode = '', mode = '', oldOid = '', oid = '', status = ''] = part.slice(1).split(' ');
      const path = parts[++index] ?? '';
      const list = out.get(current) ?? [];
      list.push({ mode, oid, oldMode, oldOid, status, path });
      out.set(current, list);
    }
    return out;
  }

  /** @type {Map<string, Change[]>} */
  const diffs = new Map();
  /** @param {Commit[]} commits Each commit against its first parent (a root against the empty tree). */
  function changesOf(commits) {
    const todo = commits.filter((commit) => !diffs.has(commit.oid));
    if (todo.length > 0) {
      const input = todo.map((commit) => [commit.oid, ...commit.parents.slice(0, 1)].join(' ')).join('\n');
      const parsed = parseRaw(git(['diff-tree', '--stdin', '--root', '-r', '-z', '--no-renames'], `${input}\n`));
      for (const commit of todo) diffs.set(commit.oid, parsed.get(commit.oid) ?? []);
    }
    return commits.map((commit) => ({ commit, changes: diffs.get(commit.oid) ?? [] }));
  }

  /** @param {string[]} args rev-list arguments @returns {Commit[]} oldest first, parents before children */
  function commitsOf(args) {
    return lines(['rev-list', '--reverse', '--topo-order', '--parents', ...args]).map((line) => {
      const [oid = '', ...parents] = line.split(' ');
      return { oid, parents };
    });
  }

  /** Blobs that first appear in `commits`: absent from every boundary parent's tree and from earlier commits in the walk. */
  /** @param {Commit[]} commits */
  function firstSeen(commits) {
    const inside = new Set(commits.map((commit) => commit.oid));
    /** @type {Set<string>} */
    const known = new Set();
    for (const commit of commits) {
      for (const parent of commit.parents) if (!inside.has(parent)) for (const oid of blobsIn(parent)) known.add(oid);
    }
    /** @type {Added[]} */
    const added = [];
    for (const { changes } of changesOf(commits)) {
      for (const change of changes) {
        if (change.status === 'D' || change.mode === '160000' || known.has(change.oid)) continue;
        known.add(change.oid);
        added.push({ oid: change.oid, path: change.path });
      }
    }
    return { added, known };
  }

  /** In a blobless clone (CI), fetch every missing blob of a set in one request instead of one fetch per object. */
  /** @param {string[]} oids */
  function prefetch(oids) {
    if (oids.length === 0) return;
    let remote = '';
    try {
      const promisor = git(['config', '--get-regexp', String.raw`^remote\..*\.promisor$`]).split('\n').find((line) => line.endsWith(' true'));
      remote = promisor?.replace(/^remote\.(.*)\.promisor true$/u, '$1') ?? '';
    } catch { /* no promisor remote */ }
    if (!remote) {
      try { remote = git(['config', '--get', 'extensions.partialClone']).trim(); } catch { return; }
    }
    if (!remote) return;
    const missing = lines(['rev-list', '--objects', '--no-object-names', '--missing=print', '--no-walk', '--stdin'], `${[...new Set(oids)].join('\n')}\n`)
      .filter((line) => line.startsWith('?')).map((line) => line.slice(1));
    if (missing.length === 0) return;
    execFileSync('git', ['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', remote, '--no-tags', '--no-write-fetch-head',
      '--recurse-submodules=no', '--filter=blob:none', '--stdin'], { cwd, env, input: `${missing.join('\n')}\n`, stdio: ['pipe', 'ignore', 'inherit'] });
  }

  /** @type {Map<string, number>} */
  const sizes = new Map();
  /** @param {string[]} oids */
  function sizeOf(oids) {
    const todo = [...new Set(oids)].filter((oid) => !sizes.has(oid));
    if (todo.length > 0) {
      prefetch(todo);
      for (const row of lines(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], `${todo.join('\n')}\n`)) {
        const [oid = '', type, bytes] = row.split(' ');
        if (type !== 'blob') throw new Error(`blob ${oid} is missing (${row}); fetch the pushed range first`);
        sizes.set(oid, Number(bytes));
      }
    }
    return sizes;
  }
  /** @param {Added[]} added @returns {number} */
  const counted = (added) => {
    const oids = [...new Set(added.filter((item) => isCounted(item.path)).map((item) => item.oid))];
    const known = sizeOf(oids);
    return oids.reduce((sum, oid) => sum + (known.get(oid) ?? 0), 0);
  };

  /** @param {string[]} oids @returns {Map<string, Buffer>} */
  function contents(oids) {
    /** @type {Map<string, Buffer>} */
    const out = new Map();
    const pending = [...new Set(oids)];
    prefetch(pending);
    const known = sizeOf(pending);
    while (pending.length > 0) {
      /** @type {string[]} */
      const chunk = [];
      let bytes = 0;
      while (pending.length > 0 && bytes < 8 * MB) {
        const oid = pending.pop() ?? '';
        chunk.push(oid);
        bytes += known.get(oid) ?? 0;
      }
      const data = execFileSync('git', ['cat-file', '--batch'], { cwd, env: gitEnv, input: `${chunk.join('\n')}\n`, maxBuffer: bytes + chunk.length * 160 + 1024 });
      let offset = 0;
      for (const oid of chunk) {
        const newline = data.indexOf(10, offset);
        const size = Number(data.subarray(offset, newline).toString().split(' ')[2]);
        out.set(oid, data.subarray(newline + 1, newline + 1 + size));
        offset = newline + 1 + size + 1;
      }
    }
    return out;
  }

  /**
   * The rules for one added or changed path/blob pair.
   * @param {Change[]} changes @param {Policy} policy @returns {string[]}
   */
  function violations(changes, policy) {
    // A pure executable-bit flip keeps its blob: nothing new to judge.
    const regular = /^1006[0-9]{2}$/u;
    // Without rename detection a move reads as delete + add; the same blob under a new path adds nothing (J122).
    const moved = new Set(changes.filter((change) => change.status === 'D').map((change) => change.oldOid));
    const live = changes.filter((change) => change.status !== 'D' && !(change.status === 'A' && moved.has(change.oid)) &&
      !(change.oid === change.oldOid && regular.test(change.mode) && regular.test(change.oldMode)));
    const known = sizeOf(live.filter((change) => change.mode !== '160000').map((change) => change.oid));
    /** @type {string[]} */
    const errors = [];
    /** @type {Change[]} */
    const sniff = [];
    for (const change of live) {
      const { path, oid, mode } = change;
      if (mode === '160000' || NESTED_GIT.test(path)) { errors.push(`${path}: nested repository / submodule`); continue; }
      if (GENERATED.test(path)) errors.push(`${path}: generated / cache / dependency path (even force-added)`);
      const bytes = known.get(oid) ?? 0;
      const pin = policy.pins.get(path);
      const pinned = pin?.oid === oid && pin.bytes === bytes;
      if (pin && !pinned) errors.push(`${path}: its pin names blob ${pin.oid.slice(0, 12)} (${pin.bytes} bytes), this is ${oid.slice(0, 12)} (${bytes}); review and update the pin`);
      if (mode === '120000') { sniff.push(change); continue; }
      const runtime = isRuntime(path);
      if (!runtime && FORBIDDEN.test(path) && !pinned) {
        errors.push(`${path}: forbidden outside public/: ${forbiddenHint(path)}`);
        continue;
      }
      const blobCap = path.endsWith('.json') ? policy.maxJsonBlobBytes : policy.maxBlobBytes;
      if (bytes > blobCap && !pinned) {
        const advice = runtime ? 'a shipped file this big needs an exact pin' : 'shrink it or keep it outside Git; an exact build/test input may be pinned';
        const pinLine = `{"path": "${path}", "oid": "${oid}", "bytes": ${bytes}, "kind": "${runtime ? 'runtime' : 'input'}", "purpose": "<why>"}`;
        errors.push(`${path}: ${mb(bytes)} is over the ${mb(blobCap)} blob cap; ${advice} in ${POLICY}: ${pinLine}`);
        continue;
      }
      if (runtime || pinned) continue;
      const board = BOARD.test(path);
      const cap = board ? policy.maxBoardBytes : policy.maxPreviewBytes;
      if (PICTURE.test(path) && bytes > cap) {
        errors.push(`${path}: ${Math.round(bytes / 1000)} KB is over the ${Math.round(cap / 1000)} KB ${board ? 'board' : 'preview image'} cap; ` +
          'save JPEG / WebP (cwebp -q 82 in.png -o out.webp; sips -s format jpeg in.png --out out.jpg) or downsize');
        continue;
      }
      sniff.push(change);
    }
    const data = contents(sniff.map((change) => change.oid));
    for (const { path, oid, mode } of sniff) {
      const body = data.get(oid) ?? Buffer.alloc(0);
      if (mode === '120000') {
        const target = body.toString('utf8');
        const resolved = posix.normalize(posix.join(posix.dirname(path), target));
        if (target.startsWith('/') || target.includes('\\') || resolved === '..' || resolved.startsWith('../') ||
          GENERATED.test(resolved) || NESTED_GIT.test(resolved)) {
          errors.push(`${path}: symlink to ${target} escapes the tree or targets generated / private storage`);
        }
        continue;
      }
      const reason = disguised(path, body);
      if (reason) errors.push(`${path}: ${reason}`);
    }
    return errors;
  }

  /** @param {string[]} errors @param {string} what */
  function refuse(errors, what) {
    if (errors.length === 0) return;
    const shown = errors.slice(0, 40).map((line) => `  ${line}`).join('\n');
    throw new Error(`${what}\n${shown}${errors.length > 40 ? `\n  … ${errors.length} violations in all` : ''}\n  Policy: docs/process/STORAGE.md`);
  }

  /** @param {string[]} tips @param {string | null} base */
  function weekOf(tips, base) {
    const since = Math.floor(now() / 1000) - 7 * 24 * 60 * 60;
    return firstSeen(commitsOf([`--since-as-filter=@${since}`, ...tips, ...(base ? ['--not', base] : [])]));
  }

  function checkIndex() {
    const head = exists('HEAD') ? git(['rev-parse', 'HEAD']).trim() : null;
    const policy = policyAt(`:${POLICY}`);
    const changes = parseRaw(git(['diff-index', '--cached', '-r', '-z', '--no-renames', head ?? emptyTree])).get('') ?? [];
    refuse(violations(changes, policy), 'REFUSED by scripts/repo-size.mjs: the staged commit breaks the storage policy');
    const before = head ? blobsIn(head) : new Set();
    /** @type {Added[]} */
    const added = changes.filter((change) => change.status !== 'D' && change.mode !== '160000' && !before.has(change.oid))
      .map((change) => ({ oid: change.oid, path: change.path }));
    const commitBytes = counted(added);
    const upstream = exists('refs/remotes/origin/main') ? ['refs/remotes/origin/main'] : [];
    const stops = [...upstream, ...(policy.migrationBase ? [policy.migrationBase] : [])];
    const pending = head ? firstSeen(commitsOf([head, ...(stops.length > 0 ? ['--not', ...stops] : [])])) : { added: [], known: new Set() };
    const pushBytes = counted([...pending.added, ...added.filter((item) => !pending.known.has(item.oid))]);
    /** @type {string[]} */
    const errors = [];
    if (pushBytes > policy.maxPushBytes) {
      errors.push(`binary bytes outside the runtime roots waiting to push would be ${mb(pushBytes)} (this commit ${mb(commitBytes)}), over the ` +
        `${mb(policy.maxPushBytes)} per-push budget; let the pusher deliver the pending commits first, or commit less media`);
    }
    const week = head ? weekOf([head], policy.migrationBase) : { added: [], known: new Set() };
    const weekBytes = counted([...week.added, ...added.filter((item) => !week.known.has(item.oid))]);
    // Advisory (Jake, 2026-10-15): the weekly budget warns until the repository is compacted; it never refuses.
    const weekOver = weekBytes > policy.maxWeeklyBytes;
    if (weekOver) {
      console.warn(`repo-size: WARNING binary bytes outside the runtime roots over the last 7 days would be ${mb(weekBytes)}, over the ` +
        `${mb(policy.maxWeeklyBytes)} weekly budget; keep media outside Git where you can`);
    }
    refuse(errors, 'REFUSED by scripts/repo-size.mjs: storage budget');
    return { changed: changes.length, commitBytes, pushBytes, weekBytes, weekOver, maxPushBytes: policy.maxPushBytes, maxWeeklyBytes: policy.maxWeeklyBytes };
  }

  /** @param {string} input git pre-push records @param {{ rangeOnly?: boolean }} [options] */
  function checkPush(input, { rangeOnly = false } = {}) {
    const updates = input.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [localRef, localOid = '', remoteRef, remoteOid = ''] = line.split(/\s+/u);
      if (!localRef || !remoteRef || !OID.test(localOid) || !OID.test(remoteOid)) throw new Error(`invalid pre-push record: ${line}`);
      return { localOid, remoteOid };
    });
    const tips = updates.map((update) => update.localOid).filter((oid) => !ZERO.test(oid));
    const [first = ''] = tips;
    if (!first) return { commits: 0, pushBytes: 0, weekBytes: null };
    const tipPolicy = policyAt(`${first}:${POLICY}`);
    const stops = updates.map((update) => update.remoteOid).filter((oid) => !ZERO.test(oid) && exists(`${oid}^{commit}`));
    // A new remote ref has no advertised base: what the remote-tracking refs hold is already published.
    if (updates.every((update) => ZERO.test(update.remoteOid))) stops.push(...lines(['for-each-ref', '--format=%(objectname)', 'refs/remotes/']));
    if (tipPolicy.migrationBase) stops.push(tipPolicy.migrationBase);
    const commits = commitsOf([...tips, ...(stops.length > 0 ? ['--not', ...stops] : [])]);
    const shallowFile = git(['rev-parse', '--git-path', 'shallow']).trim();
    let shallow = new Set();
    try { shallow = new Set(readFileSync(resolve(cwd, shallowFile), 'utf8').split('\n').filter(Boolean)); } catch { /* not shallow */ }
    const cut = commits.find((commit) => shallow.has(commit.oid));
    if (cut) throw new Error(`history is shallow at ${cut.oid}: fetch the pushed range down to its base first`);
    /** @type {string[]} */
    const errors = [];
    for (const { commit, changes } of changesOf(commits)) {
      const policy = hasPolicy(commit.oid) ? policyAt(`${commit.oid}:${POLICY}`) : tipPolicy;
      for (const error of violations(changes, policy)) errors.push(`${commit.oid.slice(0, 10)} ${error}`);
    }
    refuse(errors, 'REFUSED by scripts/repo-size.mjs: an outgoing commit breaks the storage policy (adding and later deleting still costs every clone)');
    const pushBytes = counted(firstSeen(commits).added);
    if (pushBytes > tipPolicy.maxPushBytes) {
      errors.push(`outgoing binary bytes outside the runtime roots are ${mb(pushBytes)}, over the ${mb(tipPolicy.maxPushBytes)} per-push budget`);
    }
    let weekBytes = null;
    let weekOver = false;
    if (!rangeOnly) {
      weekBytes = counted(weekOf(tips, tipPolicy.migrationBase).added);
      weekOver = weekBytes > tipPolicy.maxWeeklyBytes;
      if (weekOver) {
        console.warn(`repo-size: WARNING binary bytes outside the runtime roots over the last 7 days are ${mb(weekBytes)}, over the ` +
          `${mb(tipPolicy.maxWeeklyBytes)} weekly budget (advisory until the repository is compacted)`);
      }
    }
    refuse(errors, 'REFUSED by scripts/repo-size.mjs: storage budget');
    return { commits: commits.length, pushBytes, weekBytes, weekOver };
  }

  /** @param {string} rev @param {{ strict?: boolean }} [options] */
  function checkTree(rev, { strict = false } = {}) {
    const commit = git(['rev-parse', '--verify', `${rev}^{commit}`]).trim();
    const policy = policyAt(`${commit}:${POLICY}`);
    /** @param {string | null} ref @returns {Map<string, string>} */
    const pairs = (ref) => new Map(ref ? git(['ls-tree', '-r', '-z', ref]).split('\0').filter(Boolean).map((row) => {
      const tab = row.indexOf('\t');
      return [row.slice(tab + 1), row.slice(0, tab).split(/\s+/u)[2] ?? ''];
    }) : []);
    const parent = exists(`${commit}^`) ? git(['rev-parse', `${commit}^`]).trim() : null;
    const baseline = policy.migrationBase && !strict ? pairs(policy.migrationBase) : new Map();
    const prior = parent ? pairs(parent) : null;
    /** @type {Change[]} */
    const checked = [];
    let files = 0;
    let bytes = 0;
    let legacyFiles = 0;
    let legacyBytes = 0;
    for (const row of git(['ls-tree', '-r', '-l', '-z', commit]).split('\0').filter(Boolean)) {
      const tab = row.indexOf('\t');
      const [mode = '', , oid = '', size = '0'] = row.slice(0, tab).trim().split(/\s+/u);
      const path = row.slice(tab + 1);
      files++;
      bytes += Number(size) || 0;
      if (baseline.get(path) === oid && (!prior || prior.get(path) === oid)) {
        legacyFiles++;
        legacyBytes += Number(size) || 0;
        continue;
      }
      checked.push({ mode, oid, oldMode: '000000', oldOid: '0'.repeat(oid.length), status: 'A', path });
    }
    refuse(violations(checked, policy), `REFUSED by scripts/repo-size.mjs: ${rev} breaks the storage policy${strict ? ' (strict: no legacy allowance)' : ''}`);
    return { rev: commit, files, bytes, legacyFiles, legacyBytes, migrationBase: strict ? null : policy.migrationBase };
  }

  return { checkIndex, checkPush, checkTree };
}

/** @param {string[]} [argv] @returns {number} exit code */
export function main(argv = process.argv.slice(2)) {
  const [mode, rev] = argv;
  try {
    const checker = createChecker();
    if (mode === '--index') {
      const result = checker.checkIndex();
      console.log(`repo-size: commit ok (${result.changed} paths): new binary ${mb(result.commitBytes)}; unpushed ${mb(result.pushBytes)} of ` +
        `${mb(result.maxPushBytes)}; 7 days ${mb(result.weekBytes)} of ${mb(result.maxWeeklyBytes)}`);
      return 0;
    }
    if (mode === '--pre-push') {
      const result = checker.checkPush(readFileSync(0, 'utf8'), { rangeOnly: argv.includes('--range-only') });
      const week = result.weekBytes === null ? '' : `; 7 days ${mb(result.weekBytes)}`;
      console.log(`repo-size: push ok (${result.commits} commits): new binary ${mb(result.pushBytes)}${week}`);
      return 0;
    }
    if (mode === '--tree' && rev) {
      const result = checker.checkTree(rev, { strict: argv.includes('--strict') });
      console.log(`repo-size: tree ok ${JSON.stringify(result)}`);
      return 0;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.error('usage: repo-size.mjs --index | --tree <rev> [--strict] | --pre-push [--range-only]');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) process.exitCode = main();
