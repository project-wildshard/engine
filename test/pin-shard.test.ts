import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {expect, test} from 'vitest';
import {movePianoStems, movePin, moveSavePin, productMounts} from '../src/scripts/pin-shard.ts';

const a = 'a'.repeat(64), b = 'b'.repeat(64);
const pins = {api: 'x', shards: [{slug: 'dunes', uploadNumber: 1, hash: a, bytes: 10}, {slug: 'nine', uploadNumber: 1, hash: a, bytes: 20}]};
const document = {shards: [{slug: 'nine', name: 'Nine', uploadNumber: 1, hash: a}, {slug: 'dunes', name: 'Dunes', uploadNumber: 1, hash: a}]};

test('moves only the published slug, in place, in both files', () => {
  const moved = movePin(pins, document, {slug: 'nine', uploadNumber: 2, hash: b, bytes: 30});
  expect(moved.pins.shards).toEqual([pins.shards[0], {slug: 'nine', uploadNumber: 2, hash: b, bytes: 30}]);
  expect(moved.document.shards).toEqual([{slug: 'nine', name: 'Nine', uploadNumber: 2, hash: b}, document.shards[1]]);
});

// Meta SHARD-COMPAT NB10: the pin commit moves the slug's released save fixture with it, so released-save-play needs
// no follow-up commit (about 22 engine main reds 11-14 to 11-21 followed shard re-pins).
test('a re-pin moves the released save fixture to the new pin, a refusal staying a refusal', () => {
  const save = {release: 'r', slug: 'nine', shardfile: a, tick: 30};
  expect(moveSavePin(save, b)).toEqual({...save, pin: b});
  expect(moveSavePin({...save, pin: 'c'.repeat(64)}, b)).toEqual({...save, pin: b});
  expect(moveSavePin({...save, refused: 'c'.repeat(64)}, b)).toEqual({...save, refused: b});
  expect(moveSavePin({...save, pin: b}, a)).toEqual(save);
});

test('refuses a slug engine never pinned', () => {
  expect(() => movePin(pins, document, {slug: 'new', uploadNumber: 1, hash: b, bytes: 1})).toThrow(/no pin to move/u);
});

// Meta MOSSGATE-ZONE MZ26: a staging-only shard (production live: null) takes its first preview pin only when the
// dispatch asks for it (`first`), named from staging's catalogue row; without it a new slug is still refused.
test('a first pin appends the slug to both files when asked', () => {
  const moved = movePin(pins, document, {slug: 'moss', uploadNumber: 21, hash: b, bytes: 5}, {name: 'Moss Hollow'});
  expect(moved.pins.shards).toEqual([...pins.shards, {slug: 'moss', uploadNumber: 21, hash: b, bytes: 5}]);
  expect(moved.document.shards).toEqual([...document.shards, {slug: 'moss', name: 'Moss Hollow', uploadNumber: 21, hash: b}]);
});

test('a first pin of a slug already pinned just moves it', () => {
  const moved = movePin(pins, document, {slug: 'nine', uploadNumber: 2, hash: b, bytes: 30}, {name: 'Nine'});
  expect(moved.pins.shards).toEqual([pins.shards[0], {slug: 'nine', uploadNumber: 2, hash: b, bytes: 30}]);
});

test('a first pin refuses a slug half pinned', () => {
  const half = {...pins, shards: [...pins.shards, {slug: 'moss', uploadNumber: 1, hash: a, bytes: 1}]};
  expect(() => movePin(half, document, {slug: 'moss', uploadNumber: 2, hash: b, bytes: 1}, {name: 'Moss'})).toThrow(/no pin to move/u);
});

test('shard-pin passes a first input through to pin-shard.ts', () => {
  const flow = readFileSync('.github/workflows/shard-pin.yml', 'utf8');
  expect(flow).toMatch(/first:\n\s+description:[^\n]+\n\s+type: boolean/u);
  expect(flow).toMatch(/node src\/scripts\/pin-shard\.ts "\$SLUG" "\$REVISION" "\$HASH" "\$CHANNEL" \$\{\{ inputs\.first && '--first' \|\| '' \}\}/u);
});

test('refuses to move a pin backwards', () => {
  const ahead = {...pins, shards: [{slug: 'nine', uploadNumber: 5, hash: a, bytes: 1}]};
  expect(() => movePin(ahead, document, {slug: 'nine', uploadNumber: 2, hash: b, bytes: 1})).toThrow(/newer than 2/u);
});

// Main red at dfb768cd0 (2026-11-19): Nalati rev 4's pin kept rev 3's Ring 1 slice row, so `pins.ts install --ring 1`
// refused it ("slice belongs to another head"). The workflow re-cuts a Ring 1 slice and commits it with the pin.
test('shard-pin re-cuts a Ring 1 slug\'s server slice and commits it with the pin', () => {
  const flow = readFileSync('.github/workflows/shard-pin.yml', 'utf8');
  const cut = flow.indexOf('node src/scripts/pins.ts slice'), move = flow.indexOf('node src/scripts/pin-shard.ts'), commit = flow.indexOf('git commit');
  expect(move).toBeGreaterThan(-1);
  expect(cut).toBeGreaterThan(move);
  expect(commit).toBeGreaterThan(cut);
  expect(flow).toMatch(/rings\.json[\s\S]*slices[\s\S]*node src\/scripts\/pins\.ts slice/u);
  expect(flow.slice(commit)).toMatch(/-- test\/pins\/shardfiles\.json [^\n]*test\/pins\/slices\.json/u);
});

test('shard-pin records only the moved Ring 1 product or slice before committing the pin', () => {
  const flow = readFileSync('.github/workflows/shard-pin.yml', 'utf8');
  const cut = flow.indexOf('node src/scripts/pins.ts slice');
  const install = flow.indexOf('node src/scripts/pins.ts install --ring 1');
  const record = flow.indexOf('src/scripts/ring-step.ts --update --only "$SLUG"');
  const commit = flow.indexOf('git commit');
  expect(flow).toMatch(/slice \|\| ring\.products\.includes\(process\.argv\[1\]\)/u);
  expect(install).toBeGreaterThan(cut);
  expect(record).toBeGreaterThan(install);
  expect(commit).toBeGreaterThan(record);
  expect(flow.slice(commit)).toMatch(/-- test\/pins\/shardfiles\.json [^\n]*test\/pins\/ring-digests\.json/u);
});

// Runs 44604771920 and 44695767780: a Ring 1 pin runs ring-setup, whose pnpm install points core.hooksPath at .githooks, and
// pre-commit then refused the pin branch outside .worktrees/. The runner commits as a non-ring pin does, with no local hooks.
test('shard-pin commits its pin branch with no local hooks after ring-setup', () => {
  const flow = readFileSync('.github/workflows/shard-pin.yml', 'utf8');
  const setup = flow.indexOf('uses: ./.github/actions/ring-setup'), unset = flow.indexOf('git config --unset core.hooksPath');
  const branch = flow.indexOf('git switch -c "$branch"'), commit = flow.indexOf('git commit');
  expect(setup).toBeGreaterThan(-1);
  expect(unset).toBeGreaterThan(setup);
  expect(branch).toBeGreaterThan(unset);
  expect(commit).toBeGreaterThan(unset);
});

// Driftwood r12 (2026-11-24, the fifth time): the pin job records only linux-x64's Ring 1 digest, and the MacBook's push gate
// refused the pin on darwin-arm64's stale row until a lane recorded it by hand. A macos-15 job records it on the pin branch.
test('shard-pin records the darwin-arm64 Ring 1 digest on the pin branch', () => {
  const flow = readFileSync('.github/workflows/shard-pin.yml', 'utf8');
  const job = flow.slice(flow.indexOf('  darwin-digest:'));
  expect(flow.indexOf('  darwin-digest:')).toBeGreaterThan(-1);
  expect(job).toContain('runs-on: macos-15');
  expect(job).toContain("needs.pin.outputs.record == 'true'");
  expect(job).toContain('ref: ${{ needs.pin.outputs.branch }}');
  expect(job).toContain('ring-step.ts --update --only "$SLUG"');
  expect(job.indexOf('git config --unset core.hooksPath')).toBeLessThan(job.indexOf('git commit'));
  expect(job).toContain('"HEAD:refs/heads/$BRANCH"');
});

// Meta SHARD-COMPAT NB10 (audit B16): Driftwood r8 published from ubuntu hashed its island stems differently, so engine's
// piano manifest named files no pin mounted (main red, 9166106aa). The pin commit now renames them to the new product's.
test('a re-pin renames the piano stems the product mounts, everywhere the manifest names them', () => {
  const manifest = JSON.stringify({slots: {island: {calm: 'island-calm-d256be45.m4a', tension: 'island-tension-aac7c988.m4a'}, title: {full: 'title-7ce82663.m4a'}},
    provenance: [{file: 'island-calm-d256be45.m4a'}, {file: 'title-7ce82663.m4a'}]}, null, 2);
  const mounts = ['/assets/music/piano/island-calm-d4e3ea34.m4a', '/assets/music/piano/island-tension-c8d2932e.m4a', '/assets/sfx/driftwood-isle/bed-1a2b3c4d.m4a'];
  const moved = movePianoStems(manifest, mounts);
  expect(moved.moved).toEqual(['island-calm-d256be45.m4a -> island-calm-d4e3ea34.m4a', 'island-tension-aac7c988.m4a -> island-tension-c8d2932e.m4a']);
  const after = JSON.parse(moved.manifest) as {slots: {island: {calm: string}; title: {full: string}}; provenance: {file: string}[]};
  expect(after.slots.island.calm).toBe('island-calm-d4e3ea34.m4a');
  expect(after.provenance.map(row => row.file)).toEqual(['island-calm-d4e3ea34.m4a', 'title-7ce82663.m4a']);
  expect(movePianoStems(moved.manifest, mounts)).toEqual({manifest: moved.manifest, moved: []});
  expect(movePianoStems(manifest, [])).toEqual({manifest, moved: []});
});

const driftwood = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as {shards: {slug: string; hash: string}[]}).shards.find(row => row.slug === 'driftwood-isle')?.hash ?? '';
const pinned = join(process.env['WILDSHARD_PIN_CACHE'] ?? join(homedir(), '.cache/wildshard/pins'), `${driftwood}.tar`);
// SF23/SF24: Driftwood's images-only upload plays its own island set from its shardfile, so its pin mounts no engine piano stem.
test.skipIf(!existsSync(pinned))('the pinned Driftwood product plays its own island set and mounts no engine piano stem', () => {
  const mounts = productMounts(new Uint8Array(readFileSync(pinned)));
  expect(mounts.filter(url => url.startsWith('/assets/music/piano/'))).toEqual([]);
  const own = mounts.filter(url => /^\/assets\/driftwood-isle\/music\/driftwood-isle\/island-(calm|tension)-[a-f0-9]{8}\.m4a$/u.test(url));
  expect(own.length).toBe(2);
  const manifest = readFileSync('public/assets/music/piano/music.json', 'utf8');
  expect(movePianoStems(manifest, mounts)).toEqual({manifest, moved: []});
}, 60_000);

test('committed pin heads name their catalogue upload number', () => {
  for (const file of ['test/pins/shardfiles.json', 'test/pins/catalogue.json', 'test/pins/staging.json']) {
    const pinned = JSON.parse(readFileSync(file, 'utf8')) as {shards: Record<string, unknown>[]};
    expect(pinned.shards.every(row => Number.isSafeInteger(row['uploadNumber']) && !('revision' in row)), file).toBe(true);
  }
});

// STANDALONE-SHARDFILES SF24: the zone table needs every pin versioned, and the two hidden open plots have their versioned
// uploads on preview only (staging hides them). A preview pin takes preview's row only for a slug staging names nowhere.
test('a zone staging hides pins its preview upload; a zone staging plays never pins from preview', async () => {
  const {pinnedRow} = await import('../src/scripts/pin-shard.ts');
  const h = (n: number): string => n.toString(16).padStart(64, '0');
  const staging = {shards: [{slug: 'mossgate', uploadNumber: 27, shardVersion: '0.1.23', hash: h(1)}]};
  const preview = {shards: [{slug: 'mossgate', uploadNumber: 27, shardVersion: '0.1.23', hash: h(1)}, {slug: 'open-plot-thin-ice', uploadNumber: 5, shardVersion: '0.0.4', hash: h(2)}]};
  expect(pinnedRow({staging, preview}, 'preview', {slug: 'open-plot-thin-ice', uploadNumber: 5, hash: h(2)})).toMatchObject({shardVersion: '0.0.4'});
  expect(() => pinnedRow({staging, preview}, 'staging', {slug: 'open-plot-thin-ice', uploadNumber: 5, hash: h(2)})).toThrow('staging names open-plot-thin-ice nowhere');
  expect(() => pinnedRow({staging, preview}, 'preview', {slug: 'mossgate', uploadNumber: 27, hash: h(1)})).toThrow("pin staging's upload");
  expect(() => pinnedRow({staging, preview}, 'preview', {slug: 'open-plot-thin-ice', uploadNumber: 4, hash: h(2)})).toThrow('preview names open-plot-thin-ice rev 5');
  expect(pinnedRow({staging}, 'staging', {slug: 'mossgate', uploadNumber: 27, hash: h(1)})).toMatchObject({shardVersion: '0.1.23'});
});

// SF24: the staging zone table (page-release/zone-table.mjs `ownZoneTable`) refuses while a pinned zone has no shard version.
test('every committed pin a zone table reads names its shard version', () => {
  const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as {shards: {slug: string; shardVersion?: string}[]};
  expect(pins.shards.filter(row => row.shardVersion === undefined).map(row => row.slug)).toEqual([]);
});
