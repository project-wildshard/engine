// WIRE-STABILITY WR7: `saves.lock.json` records every persisted save key's version, shape and migrations. A shape change
// without a `version` bump, a bump without `migrate[v-1]`, a lower version or a dropped key fails here, in pre-push and CI.
// Refresh after an allowed change: SAVES_LOCK_WRITE=1 pnpm exec vitest run test/saves-lock.test.ts (it refuses the rest).
// oxlint-disable-next-line import/no-nodejs-modules -- The lock is a committed file; its fingerprint is a hash.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Read and write the committed lock.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare with the lock on main, so a hand edit cannot hide a change.
import { execFileSync } from 'node:child_process';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import type { SaveKeyDef } from '../src/shared/engine/saves/store';
import { saveShape } from '../src/shared/engine/saves/shape';
import { definitions } from './fixtures/saveDefinitions';

const LOCK = 'src/shared/engine/saves/saves.lock.json';
/** Files that hold a save definition and are not read above, each with why. */
const OUTSIDE: Readonly<Record<string, string>> = {
  'src/shared/game/loadout/persistence.ts': 'a shard file supplies its key, fields and version (rows.persistence): the shard owns that ABI',
  'src/client/game/pageSaveKeys.ts': 'stubs: they only name keys an import keeps',
  'src/shared/game/plugin/director.ts': 'a director queue scope, not a save key',
  'src/shared/engine/saves/legacy.ts': 'the epoch carry, not a save key',
  'src/shared/engine/saves/store.ts': 'the store itself',
};
const READ = new Set(['src/server/host/standalone/continuation.ts', 'src/server/game/grid/durability.ts', 'src/shared/game/saves.ts',
  'src/shared/game/localSaveKeys.ts', 'src/shared/game/ledger.ts', 'src/shared/game/quest/pagePersistence.ts', 'src/shared/game/quest/legacyRecords.ts',
  'src/shared/game/shardfile/runtimeState.ts', 'src/shared/game/shardfile/clientState.ts', 'src/shared/game/shardfile/buildingDoor.ts',
  'src/shared/game/grid/wallet.ts', 'src/shared/game/grid/runtimeCheckpoint.ts', 'src/shared/game/grid/recovery.ts',
  'src/shared/engine/world/interact/flags.ts', 'src/client/host/online/voice.ts', 'src/client/game/summary.ts', 'src/client/game/travel/travel.ts',
  'src/client/game/grid/pageEntry.ts', 'src/client/game/grid/refusal.ts', 'src/client/game/session/crashResume.ts',
  'src/client/game/grid/titlePrefetchChoice.ts', 'src/client/game/grid/intent.ts', 'src/client/engine/ui/voiceSettings.ts',
  'src/client/engine/input/bindings.ts', 'src/client/engine/telemetry/health.ts', 'src/client/engine/saves/slots.ts']);

interface LockKey { readonly version: number; readonly shape: string; readonly migrations: readonly number[] }
interface Lock { readonly format: 1; readonly keys: Readonly<Record<string, LockKey>>; readonly retired: Readonly<Record<string, number>> }

const fingerprint = (definition: SaveKeyDef<unknown>): string => createHash('sha256').update(JSON.stringify(saveShape(definition.schema))).digest('hex').slice(0, 16);
function generate(defs: ReadonlyMap<string, SaveKeyDef<unknown>>): Record<string, LockKey> {
  return Object.fromEntries([...defs].map(([id, definition]) => [id, { version: definition.version, shape: fingerprint(definition),
    migrations: Object.keys(definition.migrate ?? {}).map(Number).sort((a, b) => a - b) }]));
}
/** What breaks the save contract between `lock` and `next`. */
function violations(lock: Lock, next: Readonly<Record<string, LockKey>>): string[] {
  const out: string[] = [];
  for (const [id, old] of Object.entries(lock.keys)) {
    const now = next[id];
    if (now === undefined) { out.push(`${id}: removed; a player's saved data under it is orphaned (keep the definition, or record it under "retired")`); continue; }
    if (now.version < old.version) out.push(`${id}: version went down from ${String(old.version)} to ${String(now.version)}`);
    else if (now.version === old.version && now.shape !== old.shape) out.push(`${id}: shape changed at version ${String(now.version)}; bump version and add migrate[${String(now.version)}]`);
    else for (let step = old.version; step < now.version; step++) if (!now.migrations.includes(step)) out.push(`${id}: version ${String(now.version)} has no migrate[${String(step)}]`);
  }
  for (const [id, now] of Object.entries(next)) if (lock.retired[id] !== undefined && now.version <= (lock.retired[id] ?? 0)) out.push(`${id}: a retired key came back without a newer version`);
  return out;
}
const committed = (): Lock => JSON.parse(readFileSync(LOCK, 'utf8')) as Lock;
/** The lock where this branch left main, when git can say. */
function mainLock(): Lock | null {
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return JSON.parse(execFileSync('git', ['show', `${base}:${LOCK}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Lock;
  } catch { return null; }
}
const text = (lock: Lock): string => `${JSON.stringify(lock, null, 2)}\n`;

test('saves.lock.json is current and every save key change keeps the contract', () => {
  const next = generate(definitions()), lock = committed(), base = mainLock();
  const broken = [...violations(lock, next), ...(base === null ? [] : violations(base, next))];
  expect([...new Set(broken)]).toEqual([]);
  const wanted: Lock = { format: 1, keys: next, retired: lock.retired };
  if (process.env['SAVES_LOCK_WRITE'] === '1') writeFileSync(LOCK, text(wanted));
  else expect(text(lock), `${LOCK} is stale: SAVES_LOCK_WRITE=1 pnpm exec vitest run test/saves-lock.test.ts`).toBe(text(wanted));
});

test('every file with a save definition is read by the lock', () => {
  const files: string[] = [];
  const walk = (dir: string): void => { for (const name of readdirSync(dir)) { const path = `${dir}/${name}`; if (statSync(path).isDirectory()) walk(path); else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) files.push(path); } };
  walk('src');
  const defining = files.filter(path => /scope: ?'(?:global|profile|shard|device|session)'/u.test(readFileSync(path, 'utf8')));
  expect(defining.filter(path => !READ.has(path) && OUTSIDE[path] === undefined)).toEqual([]);
});

test("changing wallet.ts's loadout schema without a bump fails the check", () => {
  const defs = definitions(), lock = committed(), loadout = defs.get('shard/platform.loadout');
  if (loadout === undefined) throw new Error('No loadout definition');
  const changed = { ...loadout, schema: v.looseObject({ selected: v.nullable(v.string()), items: v.array(v.unknown()), charge: v.number() }) };
  expect(violations(lock, generate(new Map([...defs, ['shard/platform.loadout', changed]])))).toEqual(['shard/platform.loadout: shape changed at version 1; bump version and add migrate[1]']);
  // A bump with no migration still fails; with migrate[1] it is the allowed path.
  expect(violations(lock, generate(new Map([...defs, ['shard/platform.loadout', { ...changed, version: 2 }]])))).toEqual(['shard/platform.loadout: version 2 has no migrate[1]']);
  expect(violations(lock, generate(new Map([...defs, ['shard/platform.loadout', { ...changed, version: 2, migrate: { 1: (old: unknown) => old } }]])))).toEqual([]);
  // A dropped key and a lower version fail too.
  const without = new Map(defs); without.delete('shard/platform.loadout');
  expect(violations(lock, generate(without))[0]).toMatch(/^shard\/platform\.loadout: removed/u);
});
