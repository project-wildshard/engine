// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { NetTickAct } from '../src/shared/engine/net/acts';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { heldArmsOf } from '../src/server/game/weapons/nativeHeld';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';

// A bot's own sabre and polearm in Nalati's product: their seats, their commands, their kills in the damage book.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
async function nalati(room: boolean): Promise<TrustedHeadlessResident> {
  const directory = builtFolder('nalati-grasslands'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product }, undefined, { room });
}
const BLADE = 1, SPEAR = 2, SECOND = 60;
const command = (seq: number, yaw: number, targetId?: string): NetCommand => ({ seq, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0,
  ...(targetId === undefined ? {} : { attack: { targetId, aim: { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } }) });

test('a tape\'s world holds no arms of the product\'s', async () => {
  const live = await nalati(false);
  expect(heldArmsOf(live.host)).toBeUndefined();
  live.dispose();
});

test('a bot fights with a sabre and a polearm of their own', async () => {
  const live = await nalati(true), { host } = live, bot = host.addPlayer('bot:1');
  const body = [...host.entities.values()].find(actor => actor.alive);
  if (body === undefined) throw new Error('Nalati has no bodies');
  const dealt: { weapon: string | undefined; source: unknown }[] = [];
  host.events.on('damage.dealt', ({ req }) => { dealt.push({ weapon: req.weaponId, source: req.source }); }, host.scope);
  const face = (): void => { const { x, y, z } = body.position; bot.resetPose({ x, y: y + 0.2, z: z + 1.2 }, 0); };
  let seq = 1;
  const swing = (slot: number): void => {
    const acts = new Map<string, readonly NetTickAct[]>([['bot:1', [{ kind: 'equip', seq, slot }]]]);
    live.step([], new Map([['bot:1', command(seq, 0)]]), acts); seq++;
    for (let tick = 0; tick < SECOND; tick++) {
      face();
      live.step([], new Map([['bot:1', command(seq, 0, tick % 20 === 0 ? body.entityId : undefined)]]), new Map()); seq++;
    }
  };
  expect(heldArmsOf(host)).toBeDefined();
  swing(BLADE);
  const held = (): typeof dealt => dealt.filter(row => row.weapon !== undefined);
  const sabre = held().length, blade = held()[0]?.weapon;
  expect(sabre).toBeGreaterThan(0);
  swing(SPEAR);
  expect(held().length).toBeGreaterThan(sabre);
  expect(held()[sabre]?.weapon).not.toBe(blade);
  expect(held().every(row => row.source === bot.health)).toBe(true);
  live.dispose();
}, 120_000);
