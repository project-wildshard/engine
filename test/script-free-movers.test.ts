// oxlint-disable-next-line import/no-nodejs-modules -- The real host runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';

// SHARD-SOURCE SS-GF2a: a scene shard with a raft (a native track mover) and no sim scripts. The server installed declared
// movers only beside a script lane, so a script-free shard's raft was drawn on the page and never moved (the dev page's
// wire posed it 0 times). A native mover now gets its own lane.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));

function raftShard(trigger: { kind: 'always' } | { kind: 'stand'; delay: number }) {
  const source = emptyShardfile({ slug: 'raft', name: 'Raft', author: 'Test', seed: 3, revision: 1 });
  const rest = { at: { x: 20, y: 0.2, z: 0 }, euler: { x: 0, y: 0, z: 0 } };
  const motion = { driver: { kind: 'track' }, trigger, track: { clip: 'ride', duration: 2, loop: 'once', speed: 1, times: [0, 2], position: [[20, 0.2, 0], [20, 0.2, -10]] } };
  source.movers = parseMovers([{ id: 'fen.raft', entity: 9101, kind: 'platform', ...rest, enabled: true,
    boxes: [{ x: 0, y: 0, z: 0, hx: 1.5, hy: 0.2, hz: 1, rot: { x: 0, y: 0, z: 0, w: 1 } }], ...lowerMoverMotion(motion, rest), ...motion, execution: 'native' }]);
  expect(source.sim.scripts).toEqual([]);
  return source;
}

test('a script-free shard steps its native mover', async () => {
  const sim = createShardfileSim(raftShard({ kind: 'always' }), new Map(), { rapier: await rapier, quest: { fact: () => undefined, coins: () => undefined } });
  try {
    expect(sim.movers).toBeDefined();
    expect(sim.movers?.pose('fen.raft').position.z).toBeCloseTo(0, 3);
    for (let i = 0; i < 150; i++) sim.host.step();
    expect(sim.movers?.pose('fen.raft').position.z).toBeCloseTo(-10, 2);
  } finally { sim.dispose(); }
});

test('a script-free shard\'s stand mover waits for a rider', async () => {
  const sim = createShardfileSim(raftShard({ kind: 'stand', delay: 0 }), new Map(), { rapier: await rapier, quest: { fact: () => undefined, coins: () => undefined } });
  try {
    // the player spawns at the cell's centre, 20 m off the raft
    for (let i = 0; i < 60; i++) sim.host.step();
    expect(sim.movers?.pose('fen.raft').position.z).toBeCloseTo(0, 3);
    // on the deck, it rides
    const player = [...sim.host.players.values()][0]; if (player === undefined) throw new Error('Missing player');
    player.position.set(20, 1, 0); player.velocity.set(0, 0, 0);
    for (let i = 0; i < 60; i++) sim.host.step();
    expect(sim.movers?.pose('fen.raft').position.z).toBeLessThan(-1);
  } finally { sim.dispose(); }
});
