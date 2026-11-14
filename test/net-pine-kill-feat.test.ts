// SERVER-PARITY SS13b: Pine's kill feats in a room. The native quest's one feat counter took every death, so only the first
// player ever got "kill 5 deer" (`pine.feat.deer5`), and a second player's kills paid the first. The page's one player counts
// every death; in a room a kill now counts for the player who landed it, filed under them and saved in their book.
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';

const FEAT = 'pine.feat.deer5', NEEDED = 5;

async function pine(room: boolean) {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, room ? { room: true } : {});
}

type Live = Awaited<ReturnType<typeof pine>>;
/** A live deer no one has killed yet. */
function deer(live: Live) {
  const body = [...live.host.entities.values()].find(entity => entity.kind === 'deer' && entity.combatActor().alive);
  if (body === undefined) throw new Error('Missing a live deer');
  return body;
}
/** `player` (or the world, for `env`) kills one deer, then two ticks file what it earned. */
function kill(live: Live, player: string | 'env', lead: string, filed: Map<string, string[]>): void {
  const body = deer(live), source = player === 'env' ? 'env' as const : live.host.players.get(player)?.health;
  if (source === undefined) throw new Error('Missing player');
  const dealt = live.host.combat.hit({ source, sourceTags: ['cover.checked'], target: body.combatActor(), amount: 100_000, point: body.position.clone(), dir: new Vector3() });
  expect(dealt?.killed).toBe(true);
  step(live, lead, filed);
}
/** The deer feat's facts two ticks file, by the player a room's ledger pays them to (`ledgerFilings`). */
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

test('in a room a kill feat counts for the player who landed the kills, and nobody is paid twice', { timeout: 120_000 }, async () => {
  const live = await pine(true);
  try {
    const { host } = live, lead = leadPlayer(host), filed = new Map<string, string[]>();
    const at = { x: lead.position.x + 6, z: lead.position.z + 6 }, y = host.groundHeightAt(at.x, at.z) + 0.2;
    const second = host.addPlayer('bot:1', { x: at.x, y, z: at.z }), third = host.addPlayer('bot:2', { x: at.x + 3, y, z: at.z });
    step(live, lead.id, filed);
    kill(live, 'env', lead.id, filed); // a death no player dealt counts for the first player, as alone
    for (let n = 0; n < NEEDED - 1; n++) kill(live, lead.id, lead.id, filed);
    expect(filed.get(lead.id)?.length, 'the first player gets it').toBe(NEEDED);
    for (let n = 0; n < NEEDED; n++) kill(live, second.id, lead.id, filed);
    expect(filed.get(second.id), 'the second player gets it, under their own name').toEqual(Array.from({ length: NEEDED }, (_, n) => `${second.id}:deer5:${String(n + 1)}`));
    for (let n = 0; n < NEEDED - 1; n++) kill(live, third.id, lead.id, filed);
    expect(filed.get(third.id)?.length, 'one kill short counts, but earns no feat').toBe(NEEDED - 1);
    for (let i = 0; i < 10; i++) step(live, lead.id, filed);
    expect(filed.get(lead.id)?.length, 'nobody is paid twice').toBe(NEEDED);
    expect(filed.get(second.id)?.length).toBe(NEEDED);
    expect(filed.get(third.id)?.length).toBe(NEEDED - 1);
    // the counts are the player's own, saved with their book
    const feats = (parts: Readonly<Record<string, string>>): unknown => JSON.parse(Object.entries(parts).find(([id]) => id.startsWith('feats:'))?.[1] ?? '{}');
    const books = questBooks(host);
    expect(feats(books.exportOf(second.id).parts)).toMatchObject({ deer5: NEEDED });
    expect(feats(books.exportOf(third.id).parts)).toMatchObject({ deer5: NEEDED - 1 });
  } finally { live.dispose(); }
});

test('alone, every death counts for the first player as before, a kill the world dealt too', { timeout: 120_000 }, async () => {
  const live = await pine(false);
  try {
    const lead = leadPlayer(live.host), filed = new Map<string, string[]>();
    for (let n = 0; n < NEEDED - 1; n++) kill(live, lead.id, lead.id, filed);
    kill(live, 'env', lead.id, filed);
    expect(filed.get(lead.id)).toEqual(Array.from({ length: NEEDED }, (_, n) => `deer5:${String(n + 1)}`));
  } finally { live.dispose(); }
});
