import { expect, test } from 'vitest';
import { DeclaredScriptWorld, type ScriptStateDeclaration } from '../src/shared/engine/script/state';
import { logicalStateFromLane, logicalStateFromWorld } from '../src/shared/game/shardfile/logicalState';

const entities = [1, 2].map(id => ({ id, name: `actor ${String(id)}`, position: [0, 0, 0] as const, fields: {}, frozen: false, interactive: true }));
const declaration: ScriptStateDeclaration = {
  shared: [{ id: 9, name: 'gate.open', type: 'bool', privacy: 'public', default: 0, min: 0, max: 1 }, { id: 2, name: 'score', type: 'f64', privacy: 'host', default: 0.5, min: -10, max: 10 }],
  player: [{ id: 4, name: 'keys', type: 'i32', privacy: 'owner', default: 0, min: 0, max: 99 }],
};

test('a live lane world gives the logical state its snapshot text does', () => {
  const world = new DeclaredScriptWorld({ fields: {}, archetypes: [], events: [], maxEntities: 2 }, entities, declaration, new Map([[2, 'zed'], [1, 'amy']]));
  world.prepare([{ op: 5, a: 9, b: 1, c: 0, d: 0 }, { op: 5, a: 2, b: -3.25, c: 0, d: 0 }, { op: 6, a: 4, b: 7, c: 0, d: 0 }], 2, 0, 0).commit();
  // The shape a lane's snapshot carries: its contract names the declaration, its world the values.
  const text = JSON.stringify({ version: 0, contract: JSON.stringify({ divisor: 1, state: world.declaration }), world: world.checkpoint(), host: {} });
  for (const version of [1, 3]) expect(logicalStateFromWorld(version, world)).toEqual(logicalStateFromLane(version, text));
  expect(logicalStateFromWorld(1, world).players.map(player => player.actorId)).toEqual(['amy', 'zed']);
});
