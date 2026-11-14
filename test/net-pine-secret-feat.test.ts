// SERVER-PARITY SS13: Pine's flag feats in a room. The native quest's one feat counter read only the world's flags (the first
// player's book), so a second player who found all three secrets never got "Off the Beaten Path" (`pine.feat.secrets`). Each
// player's flag feats now count that player's own book, and a feat they reach is filed under them.
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';

const FEAT = 'pine.feat.secrets', SECRETS = ['secret:vista', 'secret:log', 'secret:islet'] as const;

async function pine(room: boolean) {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, room ? { room: true } : {});
}

type Live = Awaited<ReturnType<typeof pine>>;
/** A find lands inside a tick, as a quest row's does: a tick's effects are what it files. */
const finds = new WeakMap<Live, (() => void)[]>();
function find(live: Live, player: string, flag: string): void {
  let queue = finds.get(live);
  if (queue === undefined) { const held: (() => void)[] = []; queue = held; finds.set(live, held); live.host.onStep('test.finds', () => { for (const run of held.splice(0)) run(); }); }
  queue.push(() => { questBooks(live.host).of(player).flags.set(flag); });
}
/** The secrets feat's facts two ticks file (a find counts by the next one), by the player a room's ledger pays them to (`ledgerFilings`). */
function step(live: Live, lead: string, filed: Map<string, string[]>): void {
  for (let tick = 0; tick < 2; tick++) {
    live.step([]);
    for (const effect of live.effects) {
      if (effect.kind !== 'fact' || effect.name !== FEAT) continue;
      const player = [...live.host.players.keys()].find(id => effect.actorId.startsWith(`${id}:`)) ?? lead;
      filed.set(player, [...filed.get(player) ?? [], effect.actorId]);
    }
  }
}

test('in a room every player who finds the three secrets gets the feat, and two of three is not enough', { timeout: 120_000 }, async () => {
  const live = await pine(true);
  try {
    const { host } = live, lead = leadPlayer(host), filed = new Map<string, string[]>();
    const at = { x: lead.position.x + 6, z: lead.position.z + 6 }, y = host.groundHeightAt(at.x, at.z) + 0.2;
    const second = host.addPlayer('bot:1', { x: at.x, y, z: at.z }), third = host.addPlayer('bot:2', { x: at.x + 3, y, z: at.z });
    step(live, lead.id, filed);
    for (const flag of SECRETS) { find(live, lead.id, flag); step(live, lead.id, filed); }
    expect(filed.get(lead.id)?.length, 'the first player gets it').toBe(3);
    for (const flag of SECRETS) { find(live, second.id, flag); step(live, lead.id, filed); }
    expect(filed.get(second.id), 'the second player gets it, under their own name').toEqual([`${second.id}:secrets:1`, `${second.id}:secrets:2`, `${second.id}:secrets:3`]);
    for (const flag of SECRETS.slice(0, 2)) { find(live, third.id, flag); step(live, lead.id, filed); }
    expect(filed.get(third.id)?.length, 'two of three is two counts, not the feat').toBe(2);
    expect(filed.get(third.id)?.includes(`${third.id}:secrets:3`)).toBe(false);
    for (let i = 0; i < 10; i++) step(live, lead.id, filed);
    expect(filed.get(lead.id)?.length, 'nobody is paid twice').toBe(3);
    expect(filed.get(second.id)?.length).toBe(3);
    // a player saved from another seat can take the lead seat, and their counts come with them
    const books = questBooks(host), saved = books.exportOf(second.id);
    const feats = (parts: Readonly<Record<string, string>>): unknown => JSON.parse(Object.entries(parts).find(([id]) => id.startsWith('feats:'))?.[1] ?? '{}');
    expect(feats(saved.parts)).toMatchObject({ secrets: 3 });
    expect(() => { books.importOf(lead.id, saved); }).not.toThrow();
    expect(feats(books.exportOf(lead.id).parts)).toMatchObject({ secrets: 3 });
  } finally { live.dispose(); }
});

test('alone, the first player gets the feat as before', { timeout: 120_000 }, async () => {
  const live = await pine(false);
  try {
    const lead = leadPlayer(live.host), filed = new Map<string, string[]>();
    for (const flag of SECRETS) { find(live, lead.id, flag); step(live, lead.id, filed); }
    expect(filed.get(lead.id)).toEqual(['secrets:1', 'secrets:2', 'secrets:3']);
  } finally { live.dispose(); }
});
