import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { compileSchema, netSchema } from '../src/shared/engine/net/schema';
import { NetRoom, type NetTickInput, type NetWorld } from '../src/server/engine/net/room';
import { directLoopback } from '../src/test/engine/netLoopback';

// Flip checklist 7: a press is judged where its player stood when they pressed. The server is a command behind, so an act
// waits for the command it was made at, and J50's cap keeps a client that never sends it from holding it for ever.
const BARE = compileSchema(netSchema<null>({ cls: 'player', fields: {} }), 0);
const steer = { keyX: 0, keyY: 0, stickX: 0, stickY: 0 };
function room(): { client: NetClient; run: () => void; acted: () => string[]; flush: () => void; pump: () => void } {
  let tick = 0;
  const heard: string[] = [], link = directLoopback(), client = new NetClient(link.client);
  const world: NetWorld = { tick: () => tick, cell: () => 0, visit: visitor => { visitor.entity('player', BARE, null); }, player: { id: 'player', cls: BARE, sample: () => undefined } };
  const net = new NetRoom({ world, step: (inputs: readonly NetTickInput[]) => { tick++; for (const { acts } of inputs) for (const act of acts) if (act.kind === 'interact') heard.push(act.id); } });
  net.join(link.server); client.hello(); link.pump(); net.open(); link.pump();
  return { client, run: () => { net.tick(); }, acted: () => heard, flush: () => { client.flush(); link.pump(); }, pump: () => { link.pump(); } };
}

test('a press waits for the command it was made at', () => {
  const { client, run, acted, flush, pump } = room();
  const seq = client.command({ steer, yaw: 0, pitch: 0, buttons: 0 });
  client.act({ kind: 'interact', seq, id: 'door.open' }); pump(); // the reliable lane beats the commands here
  run(); run();
  expect(acted()).toEqual([]);
  flush(); run();
  expect(acted(), 'the tick that takes the command judges the press').toEqual(['door.open']);
});

test('a press of a command that never comes is judged anyway, at the rewind cap', () => {
  const { client, run, acted, pump } = room();
  client.act({ kind: 'interact', seq: 9, id: 'door.open' }); pump();
  for (let tick = 0; tick < 11; tick++) run();
  expect(acted()).toEqual([]);
  run(); run();
  expect(acted()).toEqual(['door.open']);
});
