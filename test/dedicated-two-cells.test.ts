// oxlint-disable-next-line import/no-nodejs-modules -- A tape's hash.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { installAppIdentity } from '../src/shared/engine/app/identity';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { serverInput } from './fixtures/dedicated/roomBench';

// J182: Dunes and Sky Reach share a worker, and some state is one per thread. So the proof that cells can share one is this: a fixed tape in Driftwood gives the same
// world with Nalati stepping beside it as it does alone, and the same for Nalati.
const DRIFTWOOD = 'driftwood-isle', NALATI = 'nalati-grasslands', TICKS = 600;
interface Run { readonly room: DedicatedRoom; readonly phones: { readonly client: NetClient; readonly link: DirectLoopback; readonly index: number }[]; readonly digest: ReturnType<typeof createHash>; now: number }
async function open(slug: string): Promise<Run> {
  const run: Run = { room: await DedicatedRoom.boot({ slug, build: 'tape', bootId: 'tape', input: await serverInput(slug), now: () => run.now, post: () => undefined }), phones: [], digest: createHash('sha256'), now: 0 };
  for (const [index, device] of ['a', 'b'].entries()) {
    const link = directLoopback(), client = new NetClient(link.client);
    run.room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello('tape', { player: device, name: device }); link.pump(); });
    link.pump();
    run.phones.push({ client, link, index });
  }
  return run;
}
function step(run: Run, tick: number): void {
  for (const { client, link, index } of run.phones) {
    const phase = (tick + index * 31) % 240;
    client.command({ viewTick: 0, steer: { keyX: 0, keyY: phase < 200 ? 1 : 0, stickX: 0, stickY: 0 }, yaw: index * 2.1 + tick / 170, pitch: 0, buttons: phase === 60 ? NET_BUTTONS.jump : phase === 120 ? NET_BUTTONS.dodge : phase === 180 ? NET_BUTTONS.sprint : 0 });
    client.flush(); link.pump();
  }
  run.now += 1000 / 60; run.room.tick();
  for (const { link } of run.phones) link.pump();
  if (tick % 60 !== 0) return;
  const rows: (string | number)[] = [tick];
  for (const player of run.room.host.players.values()) rows.push(player.id, player.position.x, player.position.y, player.position.z, player.yaw);
  for (const [id, sim] of run.room.host.entities) rows.push(id, sim.position.x, sim.position.y, sim.position.z, sim.hp);
  run.digest.update(JSON.stringify(rows));
}
function finished(run: Run): string { const hash = run.digest.digest('hex'); run.room.dispose(); return hash; }
async function alone(slug: string): Promise<string> {
  const run = await open(slug);
  for (let tick = 0; tick < TICKS; tick++) step(run, tick);
  return finished(run);
}

test('a cell steps the same beside another as it does alone', { timeout: 120_000 }, async () => {
  installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: 'wildshard.room.', saveFormat: '', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
  const lone = { driftwood: await alone(DRIFTWOOD), nalati: await alone(NALATI) }, a = await open(DRIFTWOOD), b = await open(NALATI);
  for (let tick = 0; tick < TICKS; tick++) { step(a, tick); step(b, tick); }
  expect({ driftwood: finished(a), nalati: finished(b) }).toEqual(lone);
});
