import { describe, expect, it } from 'vitest';
import { hasServerPlan, planProduct, rawServerPlan, sectionsPlan, serverPlan, serverPlanFeatures } from '../src/server/game/shardfile/serverPlan';

/** SHARD-COMPAT HS6c: the server reads its own `server/plan` (format HS6b) and the page's `client/plan` only for a file
 *  written before the SDK wrote one. */
const pagePlan = { version: 1, features: [{ kind: 'debug.expose', name: 'page' }] };
const ownPlan = { version: 1, features: [{ kind: 'debug.expose', name: 'server' }] };
const product = (sections: Record<string, unknown>) => ({
  has: (name: string) => Object.hasOwn(sections, name),
  section: ((name: string) => { if (!Object.hasOwn(sections, name)) throw new Error(`no ${name}`); return sections[name]; }) as never,
});

describe('the server plan seam', () => {
  it('reads server/plan when the file has one', () => {
    const both = product({ 'client/plan': pagePlan, 'server/plan': ownPlan });
    expect(serverPlan(both)).toEqual(ownPlan);
    expect(serverPlanFeatures(both)).toEqual(ownPlan.features);
    expect(sectionsPlan(new Map<string, unknown>([['client/plan', pagePlan], ['server/plan', ownPlan]]))).toEqual(ownPlan);
    expect(rawServerPlan(undefined, both)).toEqual(ownPlan);
  });
  it('falls back to client/plan for a file written before server/plan', () => {
    const old = product({ 'client/plan': pagePlan });
    expect(hasServerPlan(old)).toBe(true);
    expect(serverPlan(old)).toEqual(pagePlan);
    expect(sectionsPlan(new Map<string, unknown>([['client/plan', pagePlan]]))).toEqual(pagePlan);
  });
  it('has none for a file with neither', () => {
    const bare = product({});
    expect(hasServerPlan(bare)).toBe(false);
    expect(serverPlanFeatures(bare)).toEqual([]);
    expect(sectionsPlan(new Map())).toBeUndefined();
    expect(rawServerPlan(undefined, bare)).toBeUndefined();
  });
  it('lends a parsed plan under either name', () => {
    const lent = planProduct(ownPlan as never);
    expect([lent.has('server/plan' as never), lent.has('client/plan'), lent.has('world/scenes')]).toEqual([true, true, false]);
  });
});
