// ONE-FORMAT OF22d2: a native world's sword from its `held/melee` section. Driftwood swings its swords through its plan's
// `item.swept` host, which reads the swept policy from a server file (`server/swords.json`). Format 0.55.0 declares the
// same policy as the `held/melee` section (OF22d1); a native plan that names no `item.swept` host now stands its melee
// from that section, before any host, so the quest host that lends the sword still finds it. The fixture is the shipped
// Driftwood product twice: as shipped, and with its plan's `item.swept` row gone and its policy as the section. The same
// three taps at the same crab land the same blows.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { NATIVE_ASSEMBLY_FILE } from '@wildshard/format/nativeAssembly';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { nativeMeleeItem } from '../src/server/game/plugin/nativeItems';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import type { HeadlessCommand } from '../src/shared/host/tickProtocol';
import { builtFolder } from '../src/test/game/builtFolder';

const STEP = 'item.driftwood-isle.swords';

async function shipped() {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted driftwood-isle output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** The shipped product with its plan's `item.swept` row gone and that row's policy file as the `held/melee` section. */
async function sectioned(fixture: Shipped): Promise<ShardFolder> {
  const { product } = fixture, plan = JSON.parse(new TextDecoder().decode(await product.file(NATIVE_ASSEMBLY_FILE))) as { features: { host: string; policy?: { file: string } }[] };
  const swept = plan.features.find(row => row.host === 'item.swept');
  if (swept?.policy === undefined) throw new Error('Driftwood\'s plan names its item.swept host');
  const policy = await product.json<unknown>(swept.policy.file);
  const bytes = new TextEncoder().encode(JSON.stringify({ ...plan, features: plan.features.filter(row => row !== swept) }));
  return { ...product,
    file: name => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : product.file(name),
    has: name => name === 'held/melee' || product.has(name),
    section: ((name: string) => name === 'held/melee' ? policy : product.section(name as never)) as ShardFolder['section'] };
}
function resident(fixture: Shipped, product: ShardFolder): Promise<NativeHeadlessResident> {
  return createNativeHeadlessResident({ shard: product.shardfile, assets: fixture.assets, rapier: fixture.rapier, product });
}
const hold = (live: NativeHeadlessResident): void => { for (const actor of live.host.entities.values()) actor.harnessHold = true; };
const stand = (live: NativeHeadlessResident): Extract<HeadlessCommand, { kind: 'player' }> => ({ kind: 'player', moveX: 0, moveZ: 0, yaw: leadPlayer(live.host).yaw });
function tick(live: NativeHeadlessResident, count: number, commands: readonly HeadlessCommand[] = [stand(live)]): void {
  for (let at = 0; at < count; at++) { hold(live); live.step(commands); }
}
/** Stand 1.4 m short of the crab nearest the start, facing it, and tap three times; the crab's health after each. */
function swings(live: NativeHeadlessResident): { readonly crab: string; readonly hp: number[]; readonly swung: number } {
  const start = leadPlayer(live.host).position, crab = [...live.host.entities.values()].filter(row => row.kind === 'crab' && row.alive)
    .sort((a, b) => a.position.distanceTo(start) - b.position.distanceTo(start))[0] as AnimalSim | undefined;
  if (crab === undefined) throw new Error('No crab');
  const p = leadPlayer(live.host).position, dx = crab.position.x - p.x, dz = crab.position.z - p.z, span = Math.hypot(dx, dz);
  const x = crab.position.x - dx / span * 1.4, z = crab.position.z - dz / span * 1.4;
  leadPlayer(live.host).resetPose({ x, y: live.host.groundHeightAt(x, z), z }, Math.atan2(-dx, -dz));
  tick(live, 2);
  const rear = new Vector3(), front = new Vector3(); crab.bodyCapsule(rear, front);
  const feet = leadPlayer(live.host).position, look = Math.asin(rear.add(front).multiplyScalar(0.5).sub(new Vector3(feet.x, feet.y + 1.68, feet.z)).normalize().y);
  const hp: number[] = [];
  for (let swing = 0; swing < 3; swing++) { tick(live, 1, [{ ...stand(live), swing: true, pitch: look }]); tick(live, 29); hp.push(crab.hp); }
  return { crab: crab.entityId, hp, swung: nativeMeleeItem(live.host, STEP).swings() };
}

test('a native plan with no item.swept host swings its held/melee section\'s sword as the host did', async () => {
  const fixture = await shipped();
  const host = await resident(fixture, fixture.product), section = await resident(fixture, await sectioned(fixture));
  try {
    expect(() => nativeMeleeItem(section.host, STEP), 'the section stands the sword').not.toThrow();
    const before = swings(host), after = swings(section);
    expect(before.swung).toBe(3);
    expect(after).toEqual(before);
    expect(after.hp.at(-1)).toBeLessThan(after.hp[0] ?? 0);
  } finally { host.dispose(); section.dispose(); }
}, 180_000);
