// oxlint-disable-next-line import/no-nodejs-modules -- Native witnesses assert there is no browser or DOM shim.
import assert from 'node:assert/strict';
import { installAppIdentity } from '../../../src/shared/engine/app/identity';
import { SaveStore, type SaveStorage } from '../../../src/shared/engine/saves/store';
import { WILDSHARD_IDENTITY } from '../../../src/client/game/identity';
import { Ledger } from '../../../src/shared/game/ledger';
import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';

/** Test storage is an actual SaveStore backend; refusal never replaces gameplay or fabricates a grant. */
class ProfileStorage implements SaveStorage {
  private readonly values = new Map<string, string>();
  refuse = false;
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.refuse) throw new Error('Witness storage refusal'); this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replaceAll(new URL('../../../', import.meta.url).href, 'repo:/');

async function sourceOf(slug: string): Promise<Shardfile> {
  const module: unknown = await import(new URL(`../../../src/shards/${slug}/shard.config.ts`, import.meta.url).href);
  if (!record(module)) throw new Error('Shard source is not a module');
  return parseShardfile(module['default']);
}

/** This is the real ledger's declared-row contract, not evidence that native gameplay emitted the fact. */
function ledgerContract(source: Shardfile): object {
  const local = new ProfileStorage(), identity = source.identity;
  const open = (): Ledger => new Ledger(new SaveStore({ local, session: null }), [{ id: identity.slug, shard: identity.slug }],
    [{ shard: identity.slug, revision: identity.revision, rules: source.ledger }], []);
  const ledger = open();
  if (source.ledger.length === 0) return { status: 'not-declared', rules: 0, gameplayEmissionProven: false };
  const facts = source.ledger.map((rule, ordinal) => ({ instance: identity.slug, shard: identity.slug, revision: identity.revision,
    entity: `witness.${String(ordinal)}`, tick: 60, ordinal, name: rule.fact, origin: rule.origin }));
  const first = facts[0]; if (first === undefined) throw new Error('Missing declared fact');
  local.refuse = true;
  assert.equal(ledger.record(first).status, 'pending');
  assert.equal(Object.keys(open().state().facts).length, 0, 'A refused write must not appear durable');
  assert.equal(ledger.flush(), false);
  local.refuse = false; assert.equal(ledger.flush(), true);
  for (const [index, fact] of facts.entries()) assert.equal(ledger.record(fact).status, index === 0 ? 'duplicate' : 'granted');
  const durable = ledger.state(), reopened = open();
  assert.deepEqual(reopened.state(), durable);
  assert.equal(Object.keys(durable.facts).length, facts.length);
  for (const rule of source.ledger) for (const reward of rule.rewards) {
    if (reward.kind !== 'achievement') throw new Error('This partial witness has no platform catalogue admission');
    assert.deepEqual(durable.achievements[JSON.stringify([identity.slug, reward.id])], {
      shard: identity.slug, id: reward.id, title: reward.title, count: 1, threshold: reward.threshold, earned: reward.threshold === 1,
    });
  }
  for (const fact of facts) assert.equal(reopened.record(fact).status, 'duplicate');
  assert.deepEqual(reopened.state(), durable, 'Replayed facts cannot advance a declared achievement twice');
  return { status: 'partial', rules: source.ledger.length, facts: Object.keys(durable.facts).length,
    achievements: Object.values(durable.achievements).map(row => ({ id: row.id, count: row.count, earned: row.earned })),
    durableReload: true, refusedWriteRetried: true, duplicateStable: true, gameplayEmissionProven: false };
}

/** Run the shipping trusted entry under exactly the template's strict Node dependency fence. */
export async function compatibilityProbe(slug: string, entry: string, mode: string): Promise<object> {
  assert.equal(typeof window, 'undefined'); assert.equal(typeof document, 'undefined');
  installAppIdentity(WILDSHARD_IDENTITY);
  if (!['all', 'headless', 'replay', 'ledger'].includes(mode)) throw new Error('Unknown compatibility proof mode');
  const results: Record<string, unknown> = {};
  if (mode !== 'ledger') {
    let dependency: string;
    try {
      await import(new URL(`../../../src/shards/${slug}/${entry}`, import.meta.url).href);
      dependency = 'Runtime imports, but no renderer-free gameplay/snapshot installer is supplied; compatibility is unproven';
    } catch (error) { dependency = reason(error); }
    if (mode === 'all' || mode === 'headless') results['headless'] = { status: 'blocked', stage: 'runtime-entry', dependency, ticksExecuted: 0 };
    if (mode === 'all' || mode === 'replay') results['replay'] = { status: 'blocked', dependency,
      checkpointCaptured: false, suffixTicksExecuted: 0, reason: 'No real headless runtime; no encounter checkpoint or complete continuation can be captured' };
  }
  if (mode === 'all' || mode === 'ledger') {
    try {
      const source = await sourceOf(slug);
      results['declarations'] = { sourceLoaded: true, ordinarySpawns: source.creatures.spawns.length, scripts: source.sim.scripts.length,
        runtimeBinds: source.runtime?.binds ?? [], runtimeSpawns: source.runtime?.spawns ?? null, quests: source.quests.quests.map(row => row.id), ledgerRules: source.ledger };
      results['ledger'] = ledgerContract(source);
    } catch (error) { results['ledger'] = { status: 'blocked', stage: 'source-import-or-ledger-contract', dependency: reason(error), gameplayEmissionProven: false }; }
  }
  return { slug, entry, compatible: false, ...results };
}
