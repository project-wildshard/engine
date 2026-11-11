// DEV-SPEED DS12: identical pins are cloned from another worktree (or kept in place) and every byte is proved by
// sha256 against the manifest a full install wrote; anything else falls back to the full install. Real Git, one
// canonical checkout and a linked plan worktree, as `worktree new` makes them.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {clonePaths} from '../../scripts/apfs-clone.mjs';
import {KEY_EXEMPT, KEY_SOURCES, MANIFEST, hashFiles, lockPins, pinsKey, reusePins, writeManifest} from '../../scripts/pins-reuse.mjs';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
const ENV = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => {
  const result = spawnSync('git', args, {cwd, env: ENV, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
/** @param {string} root @param {string} path @param {string} body */
const put = (root, path, body) => { mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), body); };
const sha = (/** @type {string|Buffer} */ body) => createHash('sha256').update(body).digest('hex');
const KEY = 'a'.repeat(64), PIN = 'b'.repeat(64);
const PRODUCT = {'shard.json': '{"a":1}\n', 'blobs/x.bin': 'x'.repeat(5000), 'mounts/assets/a/m.bin': 'mount\n', 'validation.json': JSON.stringify({pin: {hash: PIN}})};
const MOUNTS = {'public/assets/a/m.bin': 'mount\n', 'public/assets/a/tracked.bin': 'tracked\n'};

/** A canonical checkout holding a full install of one product, and a fresh plan worktree. */
function repos() {
  const root = mkdtempSync(join(tmpdir(), 'pins-reuse-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  put(root, '.gitignore', '/out/\n/.worktrees/\n/public/assets/a/m.bin\n');
  put(root, 'public/assets/a/tracked.bin', MOUNTS['public/assets/a/tracked.bin']);
  put(root, 'test/pins/shardfiles.json', JSON.stringify({shards: [{slug: 'dunes', hash: PIN}]}));
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed']);
  git(root, ['worktree', 'add', '-q', '-b', 'plan/p', '.worktrees/p', 'main']);
  for (const [path, body] of Object.entries(PRODUCT)) put(root, `out/dunes/${path}`, body);
  put(root, 'public/assets/a/m.bin', MOUNTS['public/assets/a/m.bin']);
  writeManifest(root, KEY, {dunes: Object.fromEntries(Object.entries(PRODUCT).map(([path, body]) => [path, sha(body)]))},
    Object.fromEntries(Object.entries(MOUNTS).map(([path, body]) => [path, sha(body)])));
  return {root, tree: join(root, '.worktrees/p')};
}

describe('pins reuse', () => {
  test('a worktree with the same key gets clones of every product file and untracked mount, all verified', async () => {
    const {root, tree} = repos();
    const reused = await reusePins(tree, KEY);
    expect(reused?.source).toBe(resolve(root));
    expect(reused?.mode).toBe(process.platform === 'darwin' ? 'clone' : 'copy');
    expect(reused?.files).toBe(6);
    // The tracked mount is the worktree's own checkout file: verified, never cloned or published.
    expect(reused?.published).toEqual(['public/assets/a/m.bin']);
    for (const [path, body] of Object.entries(PRODUCT)) expect(readFileSync(join(tree, 'out/dunes', path), 'utf8')).toBe(body);
    expect(readFileSync(join(tree, 'public/assets/a/m.bin'), 'utf8')).toBe('mount\n');
    expect(JSON.parse(readFileSync(join(tree, MANIFEST), 'utf8')).key).toBe(KEY);
    // Unchanged pins in the same tree are verified in place.
    const again = await reusePins(tree, KEY, {sources: []});
    expect(again).toMatchObject({source: resolve(tree), mode: 'in place', files: 6});
  });

  test('another key, a changed byte, an extra file, a link or a changed tracked mount means the full install', async () => {
    const {root, tree} = repos();
    expect(await reusePins(tree, 'other'.padEnd(64, '0'))).toBeUndefined();
    /** @type {string[]} */
    const lines = [];
    const log = (/** @type {string} */ line) => { lines.push(line); };

    put(root, 'out/dunes/blobs/x.bin', 'y'.repeat(5000));
    expect(await reusePins(tree, KEY, {log})).toBeUndefined();
    expect(lines.at(-1)).toMatch(/out\/dunes\/blobs\/x\.bin does not hash to the manifest/u);
    // A refused source leaves nothing of itself behind.
    expect(existsSync(join(tree, 'out/dunes'))).toBe(false);
    expect(existsSync(join(tree, 'public/assets/a/m.bin'))).toBe(false);
    put(root, 'out/dunes/blobs/x.bin', PRODUCT['blobs/x.bin']);

    put(root, 'out/dunes/stray.json', '{}');
    expect(await reusePins(tree, KEY, {log})).toBeUndefined();
    expect(lines.at(-1)).toMatch(/stray\.json is not in the manifest/u);
    rmSync(join(root, 'out/dunes/stray.json'));

    symlinkSync('shard.json', join(root, 'out/dunes/link.json'));
    expect(await reusePins(tree, KEY, {log})).toBeUndefined();
    expect(lines.at(-1)).toMatch(/not a regular file/u);
    rmSync(join(root, 'out/dunes/link.json'));

    put(tree, 'public/assets/a/tracked.bin', 'edited\n');
    expect(await reusePins(tree, KEY, {log})).toBeUndefined();
    expect(lines.at(-1)).toMatch(/tracked\.bin does not hash/u);
    put(tree, 'public/assets/a/tracked.bin', MOUNTS['public/assets/a/tracked.bin']);

    expect(await reusePins(tree, KEY, {log})).toMatchObject({mode: process.platform === 'darwin' ? 'clone' : 'copy'});
  });

  test('a manifest naming a path outside out/<folder> or public/ is never followed', async () => {
    const {root, tree} = repos();
    writeManifest(root, KEY, {'..': {}}, {});
    /** @type {string[]} */
    const lines = [];
    expect(await reusePins(tree, KEY, {log: line => { lines.push(line); }})).toBeUndefined();
    writeManifest(root, KEY, {}, {'public/../escape': sha('x')});
    expect(await reusePins(tree, KEY, {log: line => { lines.push(line); }})).toBeUndefined();
    expect(lines).toEqual([expect.stringMatching(/malformed manifest/u), expect.stringMatching(/malformed manifest/u)]);
  });

  test('J206 review: links, ledger paths, nested links, modes, missing pins and odd schemas all refuse', async () => {
    const {root, tree} = repos();
    /** @type {string[]} */
    const lines = [];
    const log = (/** @type {string} */ line) => { lines.push(line); };
    const outside = mkdtempSync(join(tmpdir(), 'pins-victim-'));
    roots.push(outside);
    put(outside, 'dunes/keep.txt', 'keep\n');
    put(outside, 'victim.txt', 'victim\n');

    // A linked out/ in the target: nothing behind it is deleted.
    symlinkSync(outside, join(tree, 'out'));
    expect(await reusePins(tree, KEY, {log})).toBeUndefined();
    expect(lines.at(-1)).toMatch(/resolves outside the tree/u);
    expect(readFileSync(join(outside, 'dunes/keep.txt'), 'utf8')).toBe('keep\n');
    rmSync(join(tree, 'out'));

    // A ledger path out of public/ is never deleted.
    put(tree, 'out/.pins.json', JSON.stringify({published: [`../../${join('..', outside, 'victim.txt')}`, 'public/../../victim.txt']}));
    expect(await reusePins(tree, KEY, {log})).toMatchObject({mode: process.platform === 'darwin' ? 'clone' : 'copy'});
    expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('victim\n');

    // A link two folders down in the source is refused, not trusted.
    rmSync(join(tree, 'out'), {recursive: true});
    symlinkSync('../shard.json', join(root, 'out/dunes/blobs/deep.json'));
    expect(await reusePins(tree, KEY, {log})).toBeUndefined();
    expect(lines.at(-1)).toMatch(/blobs\/deep\.json is not a regular file/u);
    rmSync(join(root, 'out/dunes/blobs/deep.json'));

    // An executable product file is not what a full install writes.
    chmodSync(join(root, 'out/dunes/shard.json'), 0o755);
    expect(await reusePins(tree, KEY, {log})).toBeUndefined();
    expect(lines.at(-1)).toMatch(/shard\.json has mode 755/u);
    chmodSync(join(root, 'out/dunes/shard.json'), 0o644);

    // A manifest that drops a pinned product proves nothing about it.
    put(tree, 'test/pins/shardfiles.json', JSON.stringify({shards: [{slug: 'dunes', hash: PIN}, {slug: 'other', hash: 'c'.repeat(64)}]}));
    expect(await reusePins(tree, KEY, {log})).toBeUndefined();
    expect(lines.at(-1)).toMatch(/not exactly the pins/u);
    put(tree, 'test/pins/shardfiles.json', JSON.stringify({shards: [{slug: 'dunes', hash: PIN}]}));

    for (const broken of [{version: 2, key: KEY, products: null, mounts: {}}, {version: 2, key: KEY, products: {dunes: {'a.json': 'nothex'}}, mounts: {}}, []]) {
      writeFileSync(join(root, MANIFEST), JSON.stringify(broken));
      expect(await reusePins(tree, KEY, {log})).toBeUndefined();
      expect(lines.at(-1)).toMatch(/malformed manifest/u);
    }
  });

  test('a linked public/ in the target is refused before anything is made behind it', async () => {
    const {tree} = repos();
    const outside = mkdtempSync(join(tmpdir(), 'pins-public-'));
    roots.push(outside);
    rmSync(join(tree, 'public'), {recursive: true, force: true});
    symlinkSync(outside, join(tree, 'public'));
    /** @type {string[]} */
    const lines = [];
    expect(await reusePins(tree, KEY, {log: line => { lines.push(line); }})).toBeUndefined();
    expect(lines.at(-1)).toMatch(/public resolves outside the tree/u);
    expect(readdirSync(outside)).toEqual([]);
  });

  test('a tree installs one at a time, a busy source is skipped, and a dead holder\'s lock is taken over', async () => {
    const {root, tree} = repos();
    const release = lockPins(root);
    expect(lockPins(root, {wait: false})).toBeUndefined();
    /** @type {string[]} */
    const lines = [];
    expect(await reusePins(tree, KEY, {log: line => { lines.push(line); }})).toBeUndefined();
    expect(lines).toEqual([expect.stringMatching(/is installing; skipped/u)]);
    release?.();
    const again = lockPins(root, {wait: false});
    expect(again).toBeTypeOf('function');
    again?.();
    // pid 2^22+1 is past macOS's and Linux's default pid range: a gone holder.
    writeFileSync(join(root, 'out/.pins.lock'), String(2 ** 22 + 1));
    const taken = lockPins(root, {wait: false});
    expect(taken).toBeTypeOf('function');
    expect(readFileSync(join(root, 'out/.pins.lock'), 'utf8')).toBe(String(process.pid));
    taken?.();
    expect(existsSync(join(root, 'out/.pins.lock'))).toBe(false);
    // A lock that is not a pid file is never taken over and never loops: it names itself.
    mkdirSync(join(root, 'out/.pins.lock'));
    expect(() => lockPins(root, {wait: false})).toThrow(/not a readable lock file/u);
    rmSync(join(root, 'out/.pins.lock'), {recursive: true});
    writeFileSync(join(root, 'out/.pins.lock'), 'garbage');
    expect(() => lockPins(root)).toThrow(/does not hold a pid/u);
  });

  test('the key changes with the pins, the installer and the validation revision', () => {
    const {root} = repos();
    const base = pinsKey(root, 'r1');
    expect(pinsKey(root, 'r2')).not.toBe(base);
    put(root, 'test/pins/shardfiles.json', '{"shards":[]}');
    const pinned = pinsKey(root, 'r1');
    expect(pinned).not.toBe(base);
    put(root, 'scripts/pin-packs.ts', '// changed');
    expect(pinsKey(root, 'r1')).not.toBe(pinned);
  });

  test('every local module the installer loads is in the key or says why its bytes cannot change out/', () => {
    const engine = resolve(import.meta.dirname, '../..');
    const imports = (/** @type {string} */ file) => [...readFileSync(join(engine, file), 'utf8').split('\n').filter(line => !line.trim().startsWith('//')).join('\n').matchAll(/(?:from\s+|import\s*\(\s*|import\s+)'(\.{1,2}\/[^']+)'/gu)]
      .map(match => join(dirname(file), match[1] ?? ''));
    const loaded = [...new Set([...imports('scripts/pins.ts'), ...imports('scripts/bake-loader.mjs')])];
    expect(loaded.length).toBeGreaterThan(5);
    for (const path of loaded) expect(KEY_SOURCES.includes(path) || Object.hasOwn(KEY_EXEMPT, path), path).toBe(true);
    for (const path of KEY_SOURCES) expect(existsSync(join(engine, path)), path).toBe(true);
  });

  test('hashFiles matches sha256 across workers and gives an unreadable file no hash', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pins-hash-'));
    roots.push(root);
    const files = Array.from({length: 200}, (_, at) => ({path: join(root, `f${String(at)}`), body: `body ${String(at)}`.repeat(at + 1)}));
    for (const file of files) writeFileSync(file.path, file.body);
    const hashes = await hashFiles([...files.map(file => ({path: file.path, bytes: file.body.length})), {path: join(root, 'missing'), bytes: 0}]);
    expect(hashes).toEqual([...files.map(file => sha(file.body)), '']);
  });

  test('clonePaths clones a file and a whole directory, and refuses a link or an existing target', () => {
    const root = mkdtempSync(join(tmpdir(), 'apfs-clone-'));
    roots.push(root);
    put(root, 'src/a/b.txt', 'b\n');
    put(root, 'one.txt', 'one\n');
    symlinkSync('one.txt', join(root, 'link.txt'));
    expect(clonePaths([[join(root, 'src'), join(root, 'dst')], [join(root, 'one.txt'), join(root, 'two.txt')]]))
      .toBe(process.platform === 'darwin' ? 'clone' : 'copy');
    expect(readFileSync(join(root, 'dst/a/b.txt'), 'utf8')).toBe('b\n');
    expect(lstatSync(join(root, 'two.txt')).isFile()).toBe(true);
    // Writing the clone leaves its source alone.
    writeFileSync(join(root, 'two.txt'), 'changed\n');
    expect(readFileSync(join(root, 'one.txt'), 'utf8')).toBe('one\n');
    expect(() => clonePaths([[join(root, 'link.txt'), join(root, 'three.txt')]])).toThrow(/not a regular file or directory|symbolic link/u);
    expect(() => clonePaths([[join(root, 'one.txt'), join(root, 'two.txt')]])).toThrow();
    expect(clonePaths([])).toBe('none');
  });

  test('pins.ts install records a manifest after a full install, reuses it next time, and a partial install drops it', () => {
    const root = mkdtempSync(join(tmpdir(), 'pins-install-'));
    roots.push(root);
    git(root, ['init', '-q', '-b', 'main']);
    put(root, 'test/pins/shardfiles.json', '{"api":"local","shards":[]}\n');
    put(root, 'package.json', '{}');
    put(root, 'pnpm-lock.yaml', '');
    const script = resolve(import.meta.dirname, '../../scripts/pins.ts');
    const pins = (/** @type {string[]} */ ...args) => spawnSync(process.execPath, [script, ...args], {cwd: root, env: {...ENV, WILDSHARD_PIN_CACHE: join(root, 'cache')}, encoding: 'utf8'});
    const first = pins('install');
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toMatch(/0 of 0 pins admitted/u);
    expect(existsSync(join(root, MANIFEST))).toBe(true);
    const second = pins('install');
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/pins reused: this tree, unchanged/u);
    const off = spawnSync(process.execPath, [script, 'install'], {cwd: root, env: {...ENV, WILDSHARD_PIN_CACHE: join(root, 'cache'), WILDSHARD_PINS_REUSE: '0'}, encoding: 'utf8'});
    expect(off.stdout).toMatch(/0 of 0 pins admitted/u);
    expect(pins('install', 'not-pinned').status).not.toBe(0);
    expect(existsSync(join(root, MANIFEST))).toBe(false);
  });
});
