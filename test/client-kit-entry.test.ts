import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import type { ShardContext } from '../src/client/game/plugin/context';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';
import { CLIENT_FEATURES, admitClientPlan, installClientPhase } from '../src/client/game/shardfile/clientPlan';
import * as claims from '../src/client/game/shardfile/heldClaimsEntry';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';


function fixture(namedFile = true, omitLegacy?: 'economy/loot' | 'look/hull-book') {
  const source = emptyShardfile({ slug: 'kit-orchard', name: 'Orchard', author: 'Fixture', revision: 1, seed: 7 });
  const sections = new Map<string, unknown>([['held/arms', {}], ['economy/loot', {}], ['look/hull-book', {}]]);
  if (omitLegacy !== undefined) sections.delete(omitLegacy);
  const files = new Map<string, { hash: string; url: string }>();
  if (namedFile) files.set('actors/creature-install.json', { hash: '0'.repeat(64), url: 'https://example.invalid/creature-install.json' });
  const product = createShardFolder({ slug: source.identity.slug, revision: 1, shardfile: source, sections, files,
    read: () => Promise.reject(new Error('No fixture read permitted')) });
  const scope = new Scope('kit-orchard'), ctx = legacyDouble<ShardContext>({ scope, product });
  return { scope, ctx };
}
const pair = [{ kind: 'held.claims.install', claims: 'orchard.claims' }, { kind: 'held.claims.prepare', id: 'orchard.claims' }];

test('unordered kit rows retain prepare, install, paths and catalogue order', async () => {
  const f = fixture(), order: string[] = [];
  const prepare = vi.spyOn(claims, 'prepareHeldClaimsEntry').mockImplementation((_ctx, id) => { order.push(`prepare:${id}`); return Promise.resolve(); });
  const install = vi.spyOn(claims, 'installHeldClaimsEntry').mockImplementation((_ctx, id) => { order.push(`install:${id}`); });
  const path = vi.spyOn(CLIENT_FEATURES['world.paths'], 'install').mockImplementation(() => { order.push('paths'); });
  const items = vi.spyOn(CLIENT_FEATURES['content.catalogue'], 'install').mockImplementation(() => { order.push('catalogue'); });
  try {
    const plan = admitClientPlan({ version: 1, features: [
      { kind: 'content.catalogue', quests: false, finishes: false, weapons: [], ammunition: [], effects: [], compendiums: [], encounters: [] },
      pair[0], { kind: 'world.paths', rows: { id: 'orchard.paths', name: 'Orchard paths' } }, pair[1],
    ] }, f.ctx.product);
    await installClientPhase(f.ctx, plan, 'kit', f.scope, 'resident');
    expect(order).toEqual([]);
    await installClientPhase(f.ctx, plan, 'kit', f.scope, 'entered');
    expect(order).toEqual(['prepare:orchard.claims', 'install:orchard.claims', 'paths', 'catalogue']);
  } finally { prepare.mockRestore(); install.mockRestore(); path.mockRestore(); items.mockRestore(); f.scope.dispose(); }
});

test('missing, mismatched and duplicate claims pairs refuse before allocation', () => {
  const f = fixture(), prepare = vi.spyOn(claims, 'prepareHeldClaimsEntry');
  try {
    for (const features of [[pair[0]], [pair[1]], [pair[0], { kind: 'held.claims.prepare', id: 'other.claims' }], [...pair, pair[1]]])
      expect(() => admitClientPlan({ version: 1, features }, f.ctx.product)).toThrow();
    expect(prepare).not.toHaveBeenCalled();
  } finally { prepare.mockRestore(); f.scope.dispose(); }
});

test('product creatures left the client plan (ONE-FORMAT OF30, FORMAT-PRUNE FP20)', () => {
  const f = fixture();
  try {
    expect(() => admitClientPlan({ version: 1, features: [{ kind: 'population.product-creatures' }] }, f.ctx.product)).toThrow('population.product-creatures, retired (FORMAT-PRUNE FP20)');
  } finally { f.scope.dispose(); }
});

test('leaving during claims preparation installs no claims', async () => {
  const f = fixture();
  const prepare = vi.spyOn(claims, 'prepareHeldClaimsEntry').mockImplementation(() => { f.scope.dispose(); return Promise.resolve(); });
  const install = vi.spyOn(claims, 'installHeldClaimsEntry');
  try {
    const plan = admitClientPlan({ version: 1, features: [...pair] }, f.ctx.product);
    await expect(installClientPhase(f.ctx, plan, 'kit', f.scope)).rejects.toThrow();
    expect(install).not.toHaveBeenCalled();
  } finally { prepare.mockRestore(); install.mockRestore(); f.scope.dispose(); }
});


test('an ordinary client plan admits sampled audio with its placement files', () => {
  const base = emptyShardfile({ slug: 'sampled-orchard', name: 'Orchard', author: 'Fixture', revision: 1, seed: 7 });
  const points = 'world/lanterns.json';
  const source = { ...base, audio: { ...base.audio, sampledScene: {
    system: 'orchard.audio', tick: 'orchard.audio.tick', debug: 'orchard.audio.debug', points: { standalone: points, cell: points },
    loopTap: 'orchard.hum', countLabel: 'lanterns', eye: 1.68, surfaces: {}, fallback: 'rock' as const,
    step: { id: 'orchard.step', voices: {}, fallback: 'orchard.stone', count: 4, walkGain: 0.7, runGain: 1 }, voices: {}, score: [],
  } } };
  const product = (hasPoints: boolean) => createShardFolder({ slug: source.identity.slug, revision: 1, shardfile: source, sections: new Map(),
    files: new Map(hasPoints ? [[points, { hash: '0'.repeat(64), url: 'https://example.invalid/lanterns.json' }]] : []),
    read: () => Promise.reject(new Error('Admission reads only declared names')) });
  const plan = { version: 1, features: [{ kind: 'audio.scene' }] };
  expect(admitClientPlan(plan, product(true)).features).toEqual(plan.features);
  expect(() => admitClientPlan(plan, product(false))).toThrow('placement files');
});
