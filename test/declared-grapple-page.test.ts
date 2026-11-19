import { expect, test, vi } from 'vitest';
import { parse } from 'valibot';
import { MeshBasicMaterial } from 'three';
import { ModesSchema } from '@wildshard/format/modes';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '@wildshard/engine/app/scope';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { ShardContext } from '@wildshard/engine/game/plugin/context';
import { emptyShardfile } from '../src/shared/host/author';
import { declaredGrappleProfile, declaredGrappleRow } from '../src/shared/game/grapple/declared';
import { declaredGrapplePresentation, declaredGrappleTool, installDeclaredGrapplePage } from '../src/client/game/grapple/declaredGrapple';
import { GrappleTool, grappleGuard, pageGrappleFacts } from '../src/client/game/grapple/tool';
import { Filament } from '../src/client/game/grapple/ribbon';
import { lendLooks } from '../src/client/game/shardfile/lentLooks';
import source from './fixtures/engine-lift/grapple.json' with { type: 'json' };

// ONE-FORMAT OF41c, the page half: a plain `state/modes` grapple row draws the same claw, rope, hook marks and lock the native
// held entry does, from the row alone: the page builds the native `GrappleTool` with the platform's presentation rows.
const tool = {
  course: { name: 'Quarry', clearance: { axis: 'x', plane: 0, min: -4, max: 4, base: 0, top: 2, ceiling: 8, owners: ['quarry.rail'] } },
  cues: source.cues, looks: source.looks,
  fact: { name: 'quarry.crossed', entity: 'quarry.pit', source: 'quarry.crossing' },
  headless: { step: 'quarry.claw', lock: 'quarry.lock', aim: 'quarry.pitch', eye: 1.68, aspect: 1, portraitFov: 70 },
};
const timings = { minRange: 2.5, maxRange: 38, zipSpeed: 14, fireTime: 0.27, biteTime: 0.1, reelTime: 0.48, windowX: 0.52, windowY: 0.68 };
const HOOKS = [{ x: -4, y: 2, z: 0 }, { x: 6, y: 3, z: -2 }];
const shard = (grapple: readonly object[]) => ({ ...emptyShardfile({ slug: 'grapple-fixture', name: 'Grapple fixture', author: 'Test', revision: 1, seed: 7 }),
  modes: parse(ModesSchema, { grapple }) });
const fakeLooks = (ids: readonly string[]) => ({ materials: new Map(ids.map(id => [id, new MeshBasicMaterial()])), setParam: () => undefined,
  setTexture: () => undefined, bindMeshMap: () => new MeshBasicMaterial() });

test('OF41c page: a timing-only grapple mode draws nothing', () => {
  const scope = new Scope('page');
  try { expect(declaredGrappleTool(legacyDouble<ShardContext>({ scope }), shard([{ id: 'hook', ...timings }]))).toBeNull(); } finally { scope.dispose(); }
});

test('OF41c page: a plain grapple mode builds the native tool from its row, the profile the server steps', () => {
  const scope = new Scope('page'), plain = shard([{ id: 'quarry.claw', ...timings, profile: tool, hooks: HOOKS }]);
  try {
    const made = declaredGrappleTool(legacyDouble<ShardContext>({ scope }), plain);
    if (made === null) throw new Error('A plain grapple mode builds no page tool');
    expect(made.tool).toBeInstanceOf(GrappleTool);
    expect(made.tool.id).toBe('tool.quarry.claw');
    expect(made.tool.slot).toBe('offhand');
    expect(made.tool.hooks).toEqual(HOOKS);
    expect(made.tool.row.ui).toMatchObject({ name: 'Quarry', icon: 'grapple' });
    expect(made.looks).toEqual([...new Set(Object.values(source.looks))]);
    // the page and the server step one course: only the equipped id differs
    const row = declaredGrappleRow(plain);
    if (row === null) throw new Error('Missing declared row');
    expect({ ...declaredGrappleProfile(row, 'tool.quarry.claw'), id: row.id }).toEqual(declaredGrappleProfile(row));
  } finally { scope.dispose(); }
});

test('OF41c page: the platform presentation draws a rope ribbon and names its rows', () => {
  const scope = new Scope('page');
  try {
    const rows = declaredGrapplePresentation('quarry.claw');
    lendLooks(scope, fakeLooks([source.looks.ribbon]));
    const ribbon = new Filament(rows.aim.ropePoints, rows.aim.ribbon, source.looks.ribbon, rows.aim.filament);
    expect(ribbon.mesh.geometry.getIndex()?.count).toBe((rows.aim.ropePoints - 1) * 6);
    expect(ribbon.mesh.geometry.getAttribute('aSide').count).toBe(rows.aim.ropePoints * 2);
    expect(Object.keys(rows.bursts).sort()).toEqual(['bite', 'dock', 'muzzle', 'sparks']);
    expect(rows.aim.systems).toEqual({ input: 'quarry.claw.input', rope: 'quarry.claw.rope', update: 'quarry.claw' });
    expect(rows.aim.chip.candidate).not.toMatch(/DRAGON|FEI/u); // the platform's words, never a shard's
  } finally { scope.dispose(); }
});

test('OF41c page: install binds the tool to its guard and adds it to the loadout unlocked', async () => {
  const scope = new Scope('page'), add = vi.fn();
  try {
    lendLooks(scope, fakeLooks(Object.values(source.looks)));
    const ctx = legacyDouble<ShardContext>({ scope, app: legacyDouble<ShardContext['app']>({ equipment: legacyDouble<NonNullable<ShardContext['app']['equipment']>>({ add }) }) });
    const installed = await installDeclaredGrapplePage(ctx, shard([{ id: 'quarry.claw', ...timings, profile: tool, hooks: HOOKS }]));
    expect(installed).toBeInstanceOf(GrappleTool);
    expect(add).toHaveBeenCalledWith(installed, { locked: false });
    expect(() => { if (installed !== null) grappleGuard(scope).bind(installed); }).toThrow('already bound');
  } finally { scope.dispose(); }
});

test('OF41c page: a plain upload binds no page ledger for its fact; a native runtime still needs one', () => {
  const plain = shard([{ id: 'quarry.claw', ...timings, profile: tool, hooks: HOOKS }]);
  const ctx = (shardfile: Shardfile) => legacyDouble<ShardContext>({ app: legacyDouble<ShardContext['app']>({}), game: legacyDouble<ShardContext['game']>({}),
    product: legacyDouble<ShardContext['product']>({ shardfile, slug: 'grapple-fixture' }) });
  expect(plain.runtime).toBeNull();
  expect(pageGrappleFacts(ctx(plain), tool)).toBeUndefined();
  expect(() => pageGrappleFacts(ctx({ ...plain, runtime: legacyDouble<NonNullable<Shardfile['runtime']>>({ binds: [] }) }), tool)).toThrow('not bound by its runtime');
});
