import * as v from 'valibot';
import type { SaveKeyDef, SaveStore, SaveSlot } from '@wildshard/engine/saves/store';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import { LedgerFactSchema, parseLedgerRules, type LedgerFact, type LedgerRule } from '@wildshard/format/ledger';
import { retiredSlugs } from './slugNames';

const natural = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER));
const schema: v.GenericSchema<BoundedLedgerSaveInput, BoundedLedgerSave> = v.looseObject({ facts: v.record(v.string(), LedgerFactSchema),
  entitlements: v.optional(v.record(v.string(), v.looseObject({ grants: natural, lastTick: natural })), {}),
  items: v.record(v.string(), v.looseObject({ item: v.string(), tier: natural, quantity: natural })),
  achievements: v.record(v.string(), v.looseObject({ shard: v.string(), id: v.string(), title: v.string(), count: natural, threshold: natural, earned: v.boolean() })) });
export type LedgerState = v.InferOutput<typeof schema>;
const ledgerSave = { key: 'platform.ledger', scope: 'profile' as const, version: 1, schema, initial: (): LedgerState => ({ facts: {}, entitlements: {}, items: {}, achievements: {} }) };

const entitlementKey = (name: string): unknown[] | null => {
  try { const parsed: unknown = JSON.parse(name); return Array.isArray(parsed) ? parsed : null; } catch { return null; }
};
/** An instance named after a retired slug (a dedicated room's slug, `blender-template-solo`) under its new name. */
const renamedInstance = (instance: string, old: string, now: string): string =>
  instance === old ? now : instance.startsWith(`${old}-`) ? `${now}${instance.slice(old.length)}` : instance;
/** What an achievement is today, by its new slug and id; undefined when the reader holds no such rule. */
export type AchievementRule = (shard: string, id: string) => { readonly title: string; readonly threshold: number } | undefined;
/** A renamed shard keeps its profile progress (TC-SHIP-g): achievements and catalogue entitlements saved under a retired
 *  slug also count under its replacement (Brasscap Mesa's blender-template). Entries already under the new slug win and
 *  the old entries stay, as the page's shard saves do (TC-SHIP-a). An entitlement carries its grants and repeat window
 *  under the instance as it was and as renamed, so neither key pays twice. An achievement carries only when `rule` (the
 *  reader's declared achievements) names it, under the declared title and threshold (a renamed shard may retitle one, and the next grant
 *  refuses a changed identity). Returns whether it added anything. */
export function carryRetiredLedger(state: LedgerState, retired: readonly (readonly [string, string])[], rule: AchievementRule): boolean {
  let changed = false;
  for (const [old, now] of retired) {
    for (const row of Object.values(state.achievements)) {
      const key = JSON.stringify([now, row.id]);
      if (row.shard !== old || state.achievements[key] !== undefined) continue;
      const declared = rule(now, row.id);
      if (declared === undefined) continue;
      // once earned, earned (a raised threshold reads full); otherwise the count, capped at the new threshold
      const count = row.earned ? declared.threshold : Math.min(row.count, declared.threshold);
      state.achievements[key] = { shard: now, id: row.id, title: declared.title, count, threshold: declared.threshold, earned: count === declared.threshold };
      changed = true;
    }
    for (const [name, grant] of Object.entries(state.entitlements)) {
      const parsed = entitlementKey(name);
      if (parsed === null || parsed.length !== 3 || parsed[1] !== old || typeof parsed[0] !== 'string') continue;
      for (const instance of new Set([parsed[0], renamedInstance(parsed[0], old, now)])) {
        const key = JSON.stringify([instance, now, parsed[2]]);
        if (state.entitlements[key] === undefined) { state.entitlements[key] = { ...grant }; changed = true; }
      }
    }
  }
  return changed;
}

/** A placement identity remains stable when its cell changes; several instances may use one package. */
export interface LedgerInstance { id: string; shard: string; cell?: readonly [number, number] }
/** Only the platform defines reward identity, quantity and an optional durable repeat allowance. */
export interface LedgerRewardPolicy { id: string; quantity: number; repeat?: { everyTicks: number; maxGrants: number } }
/** Catalogue grants default to one item, once per stable instance and shard, independent of author facts or revisions. */
export interface LedgerCatalogueItem { id: string; maxTier: number; reward?: LedgerRewardPolicy }
/** Refuse every inadmissible mapping at world load, before a player or save exists. */
export function admitLedgerRewards(input: unknown, catalogue: readonly LedgerCatalogueItem[]): readonly LedgerRule[] {
  const items = new Map(catalogue.map(item => [item.id, item]));
  if (items.size !== catalogue.length || catalogue.some(item => !Number.isSafeInteger(item.maxTier) || item.maxTier < 0)) throw new Error('Invalid platform catalogue');
  const rules = parseLedgerRules(input);
  for (const rule of rules) for (const reward of rule.rewards) if (reward.kind === 'catalogue') {
    const item = items.get(reward.item);
    if (item === undefined || reward.tier > item.maxTier || reward.quantity !== (item.reward?.quantity ?? 1)) throw new Error('Reward is outside the platform catalogue policy');
  }
  return rules;
}
/** A grant is confirmed only by a durable save write; a pending receipt may be retried. */
export interface LedgerReceipt {
  id: string; status: 'granted' | 'duplicate' | 'pending';
  /** Whether this exact fact belongs to the atomic grant document, including a pending durable write. */
  recorded: boolean;
}
/** Collision-free instance + package + revision + entity + tick + ordinal; relocation changes no key. */
export function ledgerFactId(fact: LedgerFact): string { return JSON.stringify([fact.instance, fact.shard, fact.revision, fact.entity, fact.tick, fact.ordinal]); }

/** Local ledger implementation: profile grants and their fact dedupe record share one atomic SaveStore write. */
export class Ledger {
  private readonly slot: SaveSlot<LedgerState>;
  private readonly instances: Map<string, string>;
  private readonly rules: Map<string, { revision: number; rule: LedgerRule }>;
  private readonly achievementRules = new Map<string, { title: string; threshold: number }>();
  private readonly pending = new Set<string>();
  private records = 0;
  private readonly catalogue: ReadonlyMap<string, LedgerRewardPolicy>;
  constructor(store: SaveStore, instances: readonly LedgerInstance[], mappings: readonly { shard: string; revision: number; rules: readonly LedgerRule[] }[], catalogue: readonly LedgerCatalogueItem[]) {
    this.instances = new Map(instances.map((instance) => [instance.id, instance.shard]));
    if (this.instances.size !== instances.length) throw new Error('Duplicate ledger instance');
    admitLedgerRewards([], catalogue);
    this.catalogue = new Map(catalogue.map((item) => [item.id, structuredClone(item.reward ?? { id: item.id, quantity: 1 })]));
    const policies = [...this.catalogue.values()];
    if (new Set(policies.map((policy) => policy.id)).size !== policies.length || policies.some((policy) => policy.id.length === 0 || policy.id.length > 128
      || !Number.isSafeInteger(policy.quantity) || policy.quantity < 1 || policy.quantity > 100
      || (policy.repeat !== undefined && (!Number.isSafeInteger(policy.repeat.everyTicks) || policy.repeat.everyTicks < 1 || !Number.isSafeInteger(policy.repeat.maxGrants) || policy.repeat.maxGrants < 1)))) throw new Error('Invalid platform reward policy');
    this.rules = new Map();
    for (const mapping of mappings) {
      if (!Number.isSafeInteger(mapping.revision) || mapping.revision < 1) throw new Error('Invalid ledger revision');
      for (const rule of admitLedgerRewards(mapping.rules, catalogue)) {
        const key = JSON.stringify([mapping.shard, mapping.revision, rule.fact]);
        if (this.rules.has(key)) throw new Error('Duplicate ledger mapping');
        this.rules.set(key, { revision: mapping.revision, rule });
        for (const reward of rule.rewards) if (reward.kind === 'achievement') this.achievementRules.set(JSON.stringify([mapping.shard, reward.id]), reward);
      }
    }
    this.slot = store.define(ledgerSave);
  }
  /** Includes pending in-memory saves, following SaveStore's offline fallback; receipts distinguish durability. */
  state(): LedgerState { return this.read(); }
  /** The saved slot with a renamed shard's progress under its new slug (TC-SHIP-g); the next grant's write keeps it. */
  private read(): LedgerState {
    const state = this.slot.read();
    carryRetiredLedger(state, retiredSlugs(), (shard, id) => this.achievementRules.get(JSON.stringify([shard, id])));
    return state;
  }
  /** Inspect the saved slot before a dedicated host permits any fallback or write. */
  get admitted(): boolean { const status = this.slot.status?.(); return status === 'absent' || status === 'valid'; }
  /** Facts offered so far (recorded or not): a checkpoint that skips idle writes treats any as a change. */
  get recordCount(): number { return this.records; }
  /** A grant still waits for a durable write. */
  get unsaved(): boolean { return this.pending.size > 0; }
  record(input: LedgerFact): LedgerReceipt {
    this.records++;
    const fact = v.parse(LedgerFactSchema, input), id = ledgerFactId(fact), mapping = this.rules.get(JSON.stringify([fact.shard, fact.revision, fact.name]));
    if (this.instances.get(fact.instance) !== fact.shard || mapping === undefined || mapping.revision !== fact.revision
      || mapping.rule.origin.kind !== fact.origin.kind || mapping.rule.origin.source !== fact.origin.source) throw new Error('Fact identity or provenance is not admitted');
    const state = this.read(), prior = state.facts[id];
    if (prior !== undefined && (prior.name !== fact.name || prior.origin.kind !== fact.origin.kind || prior.origin.source !== fact.origin.source)) throw new Error('Fact identity reused for another outcome');
    if (prior === undefined) {
      let changed = false;
      for (const reward of mapping.rule.rewards) changed = this.grant(state, fact, reward) || changed;
      // An already entitled outcome cannot grow profile storage by minting fresh fact ids every tick.
      if (!changed) return { id, status: 'duplicate', recorded: false };
      state.facts[id] = fact;
    }
    // A duplicate also retries the identical document: SaveStore may contain a failed-write memory fallback,
    // even when this Ledger was reconstructed against that same store without its original pending set.
    if (!this.slot.write(state)) { this.pending.add(id); return { id, status: 'pending', recorded: true }; }
    const retried = this.pending.has(id); this.pending.clear();
    return { id, status: prior === undefined || retried ? 'granted' : 'duplicate', recorded: true };
  }
  private grant(state: LedgerState, fact: LedgerFact, reward: LedgerRule['rewards'][number]): boolean {
    if (reward.kind === 'catalogue') {
      const policy = this.catalogue.get(reward.item); if (policy === undefined) throw new Error('Missing admitted reward policy');
      const entitlement = JSON.stringify([fact.instance, fact.shard, policy.id]), prior = state.entitlements[entitlement];
      if (prior !== undefined && (policy.repeat === undefined || prior.grants >= policy.repeat.maxGrants || fact.tick < prior.lastTick || fact.tick - prior.lastTick < policy.repeat.everyTicks)) return false;
      const key = JSON.stringify([reward.item, reward.tier]), previous = state.items[key]?.quantity ?? 0;
      const quantity = previous + policy.quantity;
      if (!Number.isSafeInteger(quantity)) throw new RangeError('Catalogue quantity overflow');
      state.items[key] = { item: reward.item, tier: reward.tier, quantity };
      state.entitlements[entitlement] = { grants: (prior?.grants ?? 0) + 1, lastTick: fact.tick };
      return true;
    }
    const key = JSON.stringify([fact.shard, reward.id]), current = state.achievements[key];
    if (current !== undefined && (current.title !== reward.title || current.threshold !== reward.threshold)) throw new Error('Achievement identity changed');
    if (current?.earned === true) return false;
    const count = Math.min(reward.threshold, (current?.count ?? 0) + 1);
    state.achievements[key] = { shard: fact.shard, id: reward.id, title: reward.title, count, threshold: reward.threshold, earned: count === reward.threshold };
    return true;
  }
  /** Retry all pending profile grants together without recomputing any reward. */
  flush(): boolean { if (this.pending.size === 0) return true; if (!this.slot.write(this.slot.read())) return false; this.pending.clear(); return true; }
}

/** Per-host fact cursor. The host supplies identity, tick and provenance; callers submit only an outcome and entity. */
export class LedgerEmitter {
  private tick = -1;
  private ordinal = 0;
  private readonly ledger: Ledger;
  private readonly identity: { instance: string; shard: string; revision: number };
  private readonly origin: LedgerFact['origin'];
  private readonly now: () => number;
  private readonly dedupe: string[];
  constructor(ledger: Ledger, identity: { instance: string; shard: string; revision: number }, origin: LedgerFact['origin'], now: () => number, dedupe: string[]) {
    this.ledger = ledger; this.identity = identity; this.origin = origin; this.now = now; this.dedupe = dedupe;
  }
  emit(name: string, entity: string): LedgerReceipt {
    const tick = this.now();
    if (tick !== this.tick) { this.tick = tick; this.ordinal = 0; }
    const fact = { ...this.identity, origin: this.origin, tick, ordinal: this.ordinal++, name, entity };
    const receipt = this.ledger.record(fact);
    // An entitled outcome cannot grow the continuation by inventing fresh fact ids every tick.
    if (receipt.recorded && !this.dedupe.includes(receipt.id)) this.dedupe.push(receipt.id);
    return receipt;
  }
  snapshot(): SimValue { return { tick: this.tick, ordinal: this.ordinal }; }
  restore(input: SimValue): void {
    const state = v.parse(v.strictObject({ tick: v.pipe(v.number(), v.integer(), v.minValue(-1), v.maxValue(Number.MAX_SAFE_INTEGER)), ordinal: natural }), input);
    this.tick = state.tick; this.ordinal = state.ordinal;
  }
}
/** Register the fact cursor with the same-engine snapshot host and retry failed durable writes in fixed steps. */
export function installLedgerEmitter(host: SimHost, ledger: Ledger, identity: { instance: string; shard: string; revision: number }, origin: LedgerFact['origin']): LedgerEmitter {
  const emitter = new LedgerEmitter(ledger, identity, origin, () => host.state.tick, host.slots.ledgerDedupe);
  host.onStep(`ledger.${origin.kind}.${origin.source}`, () => { ledger.flush(); }, { snapshot: () => emitter.snapshot(), restore: (state) => { emitter.restore(state); } });
  return emitter;
}

/** Complete admitted data, independent of validator implementation metadata. */
interface BoundedLedgerSaveInputFields {
    facts: Record<string, LedgerFact>;
    entitlements?: Record<string, {
            grants: number;
            lastTick: number;
        }> | undefined;
    items: Record<string, {
            item: string;
            tier: number;
            quantity: number;
        }>;
    achievements: Record<string, {
            shard: string;
            id: string;
            title: string;
            count: number;
            threshold: number;
            earned: boolean;
        }>;
}
type BoundedLedgerSaveInput = { [Key in keyof BoundedLedgerSaveInputFields]: BoundedLedgerSaveInputFields[Key] };
interface BoundedLedgerSaveFields {
    facts: Record<string, LedgerFact>;
    entitlements: Record<string, {
            grants: number;
            lastTick: number;
        }>;
    items: Record<string, {
            item: string;
            tier: number;
            quantity: number;
        }>;
    achievements: Record<string, {
            shard: string;
            id: string;
            title: string;
            count: number;
            threshold: number;
            earned: boolean;
        }>;
}
type BoundedLedgerSave = { [Key in keyof BoundedLedgerSaveFields]: BoundedLedgerSaveFields[Key] };
/** WIRE-STABILITY WR7: this file's save keys, for saves.lock.json (test/saves-lock.test.ts). */
export const ledgerSaves: readonly SaveKeyDef<unknown>[] = [ledgerSave];
