// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { socketLiftEntries } from '@wildshard/format/socketLiftAssets';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { carryPrompt, liftPrompt } from '../src/shared/game/shardfile/wirePrompts';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { tickCommands } from '../src/shared/host/tickProtocol';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';

// J130: what a page's traversal prompts say to a server, on shipped products: a carry and a lift by name, a cable by its mode.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const opened: TrustedHeadlessResident[] = [];
afterEach(() => { for (const live of opened.splice(0)) live.dispose(); });
let product: Awaited<ReturnType<typeof loadHeadlessFolder>>;
async function resident(slug: string): Promise<TrustedHeadlessResident> {
  const directory = builtFolder(slug);
  product = await loadHeadlessFolder(directory);
  const assets = runtimeAssets(product, directory);
  const live = await createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
  opened.push(live); return live;
}
const press = (live: TrustedHeadlessResident, id: string): void => {
  live.step(tickCommands([], 8), new Map(), new Map([[leadPlayer(live.host).id, [{ kind: 'interact', seq: 1, id }]]]));
};
const idle = (live: TrustedHeadlessResident, ticks: number): void => { for (let tick = 0; tick < ticks; tick++) live.step(tickCommands([], 8)); };
const stand = (live: TrustedHeadlessResident, x: number, y: number, z: number): void => {
  const player = leadPlayer(live.host);
  player.position.set(x, y, z); player.motor.resetAt(player.position);
};

test('a carry prompt answers a client who stands at it, and the ride leads their body', async () => {
  const live = await resident('pine-hollow'), { host } = live, player = leadPlayer(host);
  const row = product.shardfile.movers.find(value => value.carry !== undefined), prompt = row?.carry?.prompts[0];
  if (row === undefined || prompt === undefined) throw new Error('Pine lost its canoe');
  const id = carryPrompt(row.id, 0);
  press(live, id); // the spawn is nowhere near the shore
  idle(live, 4);
  expect(player.led).toBe(false);
  stand(live, ...prompt.at);
  press(live, id);
  idle(live, 4);
  expect(player.led).toBe(true);
}, 10_000);

test('a lift takes a call from its island, and from nowhere else', async () => {
  const live = await resident('far-reach'), { host } = live, player = leadPlayer(host), entry = socketLiftEntries(product.shardfile.entryways)[0];
  if (entry === undefined) throw new Error('Far Reach lost its lifts');
  const { lift } = entry, id = liftPrompt(lift.mover, 1);
  stand(live, 150, 200, 150);
  press(live, id);
  const [x, y, z] = lift.roadStop;
  stand(live, x, y, z + 30); // well inside the old 40 m, and past the deck's prompt
  press(live, id);
  stand(live, ...lift.roadStop);
  idle(live, 30);
  const low = player.position.y;
  press(live, id);
  idle(live, 240);
  expect(player.position.y - low).toBeGreaterThan(0.5); // the deck takes who stands on it
}, 10_000);
