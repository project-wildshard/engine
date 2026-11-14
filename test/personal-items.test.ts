// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { decodeEvents, encodeEvents } from '../src/shared/engine/net/messages';
import { BitWriter } from '../src/shared/engine/net/bits';
import { LedgerBookSchema } from '../src/server/engine/net/ledgerBook';
import * as v from 'valibot';
import { installPersonalLoot, personalItemTable, type PersonalLootPorts } from '../src/server/game/loot/personal';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { ledgerFilings } from '../src/server/host/standalone/ledgerFilings';
import { builtFolder } from './fixtures/builtFolder';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// J105: an item is a personal roll too, through the ledger, for each player who earned it.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

function fight(items: NonNullable<PersonalLootPorts['items']>): { host: ReturnType<typeof createSimHost>; paid: string[]; kill: () => void } {
  const host = createSimHost(SIM_LEVEL, { rapier }), paid: string[] = [], lead = [...host.players.keys()][0] ?? '';
  host.addPlayer('bot:1', { x: 3, y: 2, z: 3 });
  installPersonalLoot(host, { coins: null, items, grant: () => undefined, grantItem: (player, item) => { paid.push(`${player}:${item}`); } });
  const body = [...host.entities.values()][0]; if (body === undefined) throw new Error('No body');
  const kill = (): void => {
    for (const id of [lead, 'bot:1']) host.damage.record({ source: host.players.get(id)?.health ?? 'env', sourceTags: [], target: body.combatActor(), amount: 10, point: new Vector3(), dir: new Vector3() }, 10, host.players);
    host.events.emit('actor.died', { actor: body.combatActor(), req: { source: 'env', sourceTags: [], target: body.combatActor(), amount: 10, point: new Vector3(), dir: new Vector3() } });
    host.step();
  };
  return { host, paid, kill };
}

test('each player who earned a body gets their own item', () => {
  const { host, paid, kill } = fight(() => [{ item: 'tusk', count: 1 }]), [lead] = host.players.keys();
  kill();
  expect(paid).toHaveLength(2); expect(paid).toEqual(expect.arrayContaining([`${lead ?? ''}:tusk`, 'bot:1:tusk']));
  expect(host.slots.ledgerDedupe.filter(row => row.endsWith(':item:tusk'))).toHaveLength(2);
});

test('what a player has been paid is theirs: a once-only trophy falls for them once', () => {
  const { paid, kill } = fight((context, _next) => context.owned?.('tusk') === true ? [] : [{ item: 'tusk', count: 1 }]);
  kill(); const first = paid.length; kill();
  expect(first).toBe(2); expect(paid).toHaveLength(2);
});

test('a lone player\'s drops stay the page\'s', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), paid: string[] = [];
  installPersonalLoot(host, { coins: null, items: () => [{ item: 'tusk', count: 1 }], grant: () => undefined, grantItem: (_player, item) => { paid.push(item); } });
  const body = [...host.entities.values()][0]; if (body === undefined) throw new Error('No body');
  host.events.emit('actor.died', { actor: body.combatActor(), req: { source: 'env', sourceTags: [], target: body.combatActor(), amount: 1, point: new Vector3(), dir: new Vector3() } });
  host.step();
  expect(paid).toEqual([]); expect(host.slots.ledgerDedupe).toEqual([]);
});

test('an item grant files to its player and survives the wire and a save', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), lead = [...host.players.keys()][0] ?? '';
  host.addPlayer('bot:1', { x: 3, y: 2, z: 3 });
  const [filing] = ledgerFilings(host, lead, [{ kind: 'item', item: 'tusk', count: 1, actorId: 'bot:1' }], null);
  expect(filing).toMatchObject({ player: 'bot:1', grant: 'item', name: 'tusk', amount: 1 });
  const { player: _player, ...grant } = filing ?? { player: '', id: '', tick: 0, grant: 'item' as const, name: '', amount: 0, pending: false };
  const event = { kind: 'ledger' as const, serial: 1, ...grant };
  expect(decodeEvents(new Uint8Array(encodeEvents(new BitWriter(), 1, [event], () => undefined)), () => undefined)?.events).toEqual([event]);
  expect(v.safeParse(LedgerBookSchema, { 'bot:1': { serial: 1, rows: [event] } }).success).toBe(true);
});

test.each(['driftwood-isle', 'pine-hollow'])('%s rolls real trophy rows', async (slug) => {
  const product = await loadHeadlessFolder(builtFolder(slug)), economy: unknown = product.section('economy/loot');
  const roll = personalItemTable(economy);
  expect(roll).not.toBeNull();
  expect(JSON.stringify(economy)).toContain('trophies');
});
