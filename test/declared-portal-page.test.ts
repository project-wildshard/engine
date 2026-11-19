// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { parse } from 'valibot';
import { DirectorsSchema } from '@wildshard/format/directorStages';
import { EntrywaysSchema } from '@wildshard/format/entryways';
import { PropsSchema } from '@wildshard/format/props';
import { Scope } from '@wildshard/engine/app/scope';
import type { ShardContext } from '@wildshard/engine/game/plugin/context';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { installDeclaredPortalRide } from '../src/client/game/shardfile/portalRideBinding';
import { emptyShardfile } from '../src/shared/host/author';

vi.mock('@wildshard/engine/ui/ownership', () => ({
  uiScope: (name: string, scope: Scope) => scope.child(name),
  mountUi: vi.fn(),
}));

test('a plain portal page installs the ride without a runtime ledger', async () => {
  const scope = new Scope('portal-page'), system = vi.fn();
  const row = { director: 'fixture.portal', trigger: { front: 0.6, back: 0.6, half: 1, feet: 0.15, reach: 1.25 },
    fade: { out: 0.28, hold: 0.12, in: 0.4 }, veil: { cls: 'portal-veil', style: {} }, landings: [] };
  const base = emptyShardfile({ slug: 'portal-page', name: 'Portal page', author: 'Fixture', revision: 1, seed: 7 });
  const director = { version: 2 as const, id: row.director,
    inputs: { touch: 'zone:fixture.portal', dark: 'event:fixture.portal-dark', clear: 'event:fixture.portal-clear' },
    stages: [{ id: 'idle', do: [{ emit: 'portal.clear' }], next: [{ target: 'held', when: 'touch' }] },
      { id: 'held', do: [{ emit: 'portal.hold' }], next: [{ target: 'transferred', when: 'dark' }] },
      { id: 'transferred', do: [{ emit: 'portal.transfer' }], next: [{ target: 'idle', when: 'clear' }] }] };
  const portal = { road: { id: 'road', at: [0, 0, 240], floor: 'deck' }, destination: { id: 'plaza.arrival', at: [50, 10, 50], floor: 'plaza' },
    exit: { id: 'plaza.exit', at: [50, 10, 56], floor: 'plaza' },
    links: [{ from: 'road', to: 'plaza.arrival' }, { from: 'plaza.exit', to: 'road' }], route: [[50, 10, 50], [50, 10, 56]] };
  const entryways = parse(EntrywaysSchema, base.entryways.map(edge => edge.edge === 'north' ? { ...edge, kind: 'portalLink', portal } : edge));
  const props = parse(PropsSchema, { version: 1, family: 'fixture', tiles: [], panels: [], models: [], far: null, textures: [],
    colliders: [{ id: 'deck', panel: null, initialActive: true, shapes: [{ kind: 'box', x: 0, y: -0.25, z: 235, hx: 10, hy: 0.25, hz: 15 }] },
      { id: 'plaza', panel: null, initialActive: true, shapes: [{ kind: 'box', x: 50, y: 9.75, z: 52, hx: 10, hy: 0.25, hz: 10 }] }] });
  type Runtime = NonNullable<ShardContext['game']['runtime']>;
  type World = NonNullable<Runtime['world']>;
  const player = legacyDouble<World['player']>({ spawn: vi.fn(), position: new Vector3(), motor: legacyDouble<World['player']['motor']>({}) });
  const world = legacyDouble<World>({ player, physics: legacyDouble<World['physics']>({}) });
  const ctx = legacyDouble<ShardContext>({ scope, system, app: legacyDouble<ShardContext['app']>({}),
    game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<Runtime>({ world, play: null }) }),
    product: legacyDouble<ShardContext['product']>({ slug: base.identity.slug, shardfile: { ...base, entryways, props, directors: parse(DirectorsSchema, [director]) } }),
  });
  try {
    const installed = await installDeclaredPortalRide(ctx, row);
    expect(installed.rides()).toEqual([]);
    expect(system).toHaveBeenCalledWith(expect.objectContaining({ id: 'game.portal-ride' }));
  } finally { scope.dispose(); }
});
