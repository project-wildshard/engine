// ONE-FORMAT OF11b: Dunes' ray (patrol diver) and strider (challenge grazer) sim the same from the program host
// (`installSpeciesHomes` over the shard's species program, as Dunes ships) and from OF11a's plain rows on the data host
// (an ordinary upload: `createShardfileSim` over the rows, a declared brain per spawn). Same level, player, bodies,
// scales and circle phases; 600 ticks; positions within 1 cm and the same strikes landing on the same ticks.
// The rows are sdk `speciesProgramToRows` over Dunes' program (sharddev `packages/sdk/test/fixtures/
// dunes-species-program.json`, shard-dunes 959969f), kept in `fixtures/dunes-of11b-rows.json` with the program.
import { readFileSync } from 'node:fs';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { expect, test } from 'vitest';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { parseShardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { admitSpeciesProgram, bakedSpecs, installSpeciesHomes, seedSlot, type BrainedSpecies } from '../src/server/game/plugin/brain';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { emptyShardfile } from '../src/shared/host/author';

const fixture = JSON.parse(readFileSync('test/fixtures/dunes-of11b-rows.json', 'utf8')) as {
  program: { species: BrainedSpecies[]; strikes: unknown[] };
  physics: Record<string, { scale: [number, number]; spec: unknown }>;
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
const base = emptyShardfile({ slug: 'of11b-dunes', name: 'Dunes rows', author: 'Test', revision: 1, seed: 7 });
/** The converted rows in a shard's rows, with the look rows their bodies name. */
const ROWS = { ...base.rows, species: fixture.rows.species, strikes: fixture.rows.strikes,
  looks: fixture.rows.species.map(row => ({ id: `sunscar.look.${row.kind}`, species: row.id, recipe: 'sunscar.rig', material: null,
    parameters: {}, animation: { recipe: 'sunscar.clips', parameters: {} } })) } as unknown as ShardRows;
/** The ray patrols its authored home; the strider grazes beside the player. */
const HOMES = [
  { id: 'ray', kind: 'duneRay', at: [8, -75] as const, yaw: 0, respawn: 25 },
  { id: 'strider', kind: 'duneStrider', at: [10, -50] as const, yaw: 0.4, respawn: 50 },
];
const TICKS = 600;
/** The player stands in reach of both, then walks off and back; both hosts read the same pose on every tick. */
function playerAt(tick: number): { x: number; z: number } {
  const t = tick / 60;
  return t < 4 ? { x: 8, z: -58 } : t < 7 ? { x: 8 + (t - 4) * 3, z: -58 + (t - 4) * 2 } : { x: 17 - (t - 7) * 2, z: -52 - (t - 7) };
}

interface Frame { readonly x: number; readonly y: number; readonly z: number; readonly attack: number; readonly state: string }
interface Hit { readonly tick: number; readonly amount: number; readonly move: string; readonly tags: readonly string[] }
function frame(host: SimHost, id: string): Frame {
  const actor = host.entities.get(id); if (actor === undefined) throw new Error(`Missing body ${id}`);
  return { x: actor.position.x, y: actor.position.y, z: actor.position.z, attack: actor.attackPhase, state: actor.state };
}
/** Step a host with the scripted player held still between ticks (a blow's knockback still moves it within its tick),
 *  recording every body and every blow landed on the player. */
function run(host: SimHost): { frames: Frame[][]; hits: Hit[] } {
  const player = leadPlayer(host), frames: Frame[][] = [], hits: Hit[] = [];
  let tick = 0;
  host.events.on('damage.dealt', ({ req, dealt }) => { hits.push({ tick, amount: dealt, move: req.moveId ?? '', tags: req.sourceTags }); }, host.scope);
  for (; tick < TICKS; tick++) {
    const at = playerAt(tick);
    player.position.set(at.x, 0, at.z); player.velocity.set(0, 0, 0); player.impulse.set(0, 0, 0);
    player.health.attributes.health = player.health.attributes.maxHealth;
    host.step();
    frames.push(HOMES.map(home => frame(host, home.id)));
  }
  return { frames, hits };
}

test('Dunes ray and strider match on the program host and the data host for 600 ticks', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const programSim = createShardfileSim(base, new Map(), { rapier }), program = programSim.host;
  // The one host difference that is not the rows: the keeper decides on ticks 1 mod 6 (the page's legacy band), the
  // data host's declared brains on ticks 0 mod 6. One step before the keeper installs lines the two cadences up.
  program.step();
  // the program host: the species program on the keeper, as Dunes' runtime plan installs it (think every 6, 2 tokens)
  installSpeciesHomes(program, { step: 'of11b.homes', seed: 5363, homes: HOMES, species: fixture.program.species,
    brains: admitSpeciesProgram(fixture.program), specs: bakedSpecs(Object.values(fixture.physics)), attackers: 2, think: { every: 6, dt: 0.1 } });
  // the data host: an ordinary upload of OF11a's rows, each body the keeper drew (scale, pose, circle phase) as a declared spawn
  const spawns = HOMES.map((home, index) => {
    const actor = program.entities.get(home.id), species = fixture.rows.species.find(row => row.kind === home.kind);
    const brain = fixture.program.species.find(row => row.kind === home.kind)?.brain;
    if (actor === undefined || species === undefined) throw new Error(`Missing program body ${home.id}`);
    return { id: home.id, species: species.id, variant: 'dusk', brain: species.temperament?.brain ?? null, strike: null, seed: 11 + index,
      scale: actor.scale, at: [actor.position.x, actor.position.y, actor.position.z] as [number, number, number], yaw: actor.yaw,
      ...(brain !== undefined && 'phaseSlots' in brain ? { phaseOffset: seedSlot(actor.seed, brain.phaseSlots) } : {}) };
  });
  const dataSim = createShardfileSim(parseShardfile({ ...base, rows: ROWS, creatures: { ...base.creatures, brains: fixture.rows.brains, spawns } }),
    new Map(), { rapier }), data = dataSim.host;
  try {
    for (const home of HOMES) expect(frame(data, home.id)).toEqual(frame(program, home.id));
    const a = run(program), b = run(data);
    // the run does something: the ray leaves its patrol and dives, the strider charges, both land a blow
    const moved = (i: number): number => { const s = a.frames[0]?.[i], e = a.frames[TICKS - 1]?.[i]; return s === undefined || e === undefined ? 0 : Math.hypot(e.x - s.x, e.z - s.z); };
    expect(moved(0)).toBeGreaterThan(5); expect(moved(1)).toBeGreaterThan(2);
    expect(a.hits.map(hit => hit.tags[0])).toEqual(['creature.duneStrider', 'creature.duneRay']);
    let worst = { d: 0, tick: -1, id: '' };
    for (let tick = 0; tick < TICKS; tick++) HOMES.forEach((home, i) => {
      const p = a.frames[tick]?.[i], q = b.frames[tick]?.[i]; if (p === undefined || q === undefined) throw new Error('Missing frame');
      const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      if (d > worst.d) worst = { d, tick, id: home.id };
    });
    expect(worst.d, JSON.stringify(worst)).toBeLessThan(0.01);
    expect(b.frames.map(row => row.map(f => [f.attack, f.state]))).toEqual(a.frames.map(row => row.map(f => [f.attack, f.state])));
    // the same blows on the same ticks, with the same tags; the program names its body's contact move, a row its strike.
    // A declared body also names its exact species row (`creature.<row id>`, AnimalSim.combatActor) beside its kind.
    const row = (tags: readonly string[]): string => `creature.${fixture.rows.species.find(entry => tags.includes(`creature.${entry.kind}`))?.id ?? ''}`;
    expect(b.hits.map(({ tick, amount, tags }) => ({ tick, amount, tags }))).toEqual(a.hits.map(({ tick, amount, tags }) => {
      const at = tags.indexOf('actor.creature') + 1;
      return { tick, amount, tags: [...tags.slice(0, at), row(tags), ...tags.slice(at)] };
    }));
    expect(a.hits.map(hit => hit.move)).toEqual(['sunscar.duneStrider.contact', 'sunscar.duneRay.contact']);
    expect(b.hits.map(hit => hit.move)).toEqual(['sunscar.strider.charge', 'sunscar.ray.swoop']);
  } finally { programSim.dispose(); dataSim.dispose(); }
});
