import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse, object, boolean, number } from "valibot";
import type { CreatureSenses } from "@wildshard/format/creatureLayers";
import { parseRows } from "@wildshard/format/rows";
import { HuntTuningSchema } from "@wildshard/format/speciesPrograms";
import { createShardfileSim } from "../src/server/game/plugin/simulation";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { addPiece } from "../src/shared/engine/physics/pieces";
import { groundFixture } from "./fixtures/plain-ground";
import { FIXTURE_HUNT_TUNING } from "./fixtures/hunt-tuning";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
function source(senses?: CreatureSenses) {
  const shard = groundFixture(),
    species = shard.rows.species[0],
    spawn = shard.creatures.spawns[0];
  if (species === undefined || spawn === undefined) throw new Error("Missing actual hunt source");
  species.temperament = {
    brain: "hunt",
    reaction: "aggressive",
    leash: 200,
    assist: 0,
    home: { speed: 2, stop: 0.5 },
    tuning: parse(HuntTuningSchema, { ...FIXTURE_HUNT_TUNING, hp: 117, noticeRate: 1 }),
  };
  if (senses !== undefined) species.senses = senses;
  shard.creatures.brains = [];
  spawn.brain = null;
  shard.spawn = { x: 0, y: 0, z: 0, yaw: 0 }; // seven metres in front
  shard.rows = parseRows(shard.rows);
  return shard;
}
const memorySchema = object({ memory: object({ sensed: boolean(), awareness: number() }) });
function memory(host: ReturnType<typeof createShardfileSim>["host"]) {
  const saved = host.adapters.get("brain.fixture.actor")?.snapshot();
  if (typeof saved !== "string") throw new Error("Missing actual hunt continuation");
  return parse(memorySchema, JSON.parse(saved)).memory;
}
const cases: { name: string; senses: CreatureSenses; behind?: boolean; seen: boolean }[] = [
  { name: "front sight", senses: { notice: 0, sight: { range: 12, cone: 0.3 } }, seen: true },
  {
    name: "closed cone",
    senses: { notice: 0, sight: { range: 12, cone: 0.3 } },
    behind: true,
    seen: false,
  },
  {
    name: "closed visual radius",
    senses: { notice: 0, sight: { range: 6, cone: 1 } },
    seen: false,
  },
  { name: "authored omni radius", senses: { notice: 12 }, behind: true, seen: true },
  { name: "closed omni radius", senses: { notice: 6 }, seen: false },
  {
    name: "still hearing behind",
    senses: {
      notice: 0,
      sight: { range: 0.1, cone: 0.1 },
      hearing: { still: 12, crouch: 12, walk: 12, sprint: 12 },
    },
    behind: true,
    seen: true,
  },
  {
    name: "closed hearing behind",
    senses: {
      notice: 0,
      sight: { range: 0.1, cone: 0.1 },
      hearing: { still: 6, crouch: 6, walk: 6, sprint: 6 },
    },
    behind: true,
    seen: false,
  },
  {
    name: "reveal behind",
    senses: { notice: 0, sight: { range: 0.1, cone: 0.1 }, reveal: 12 },
    behind: true,
    seen: true,
  },
  {
    name: "closed reveal",
    senses: { notice: 0, sight: { range: 0.1, cone: 0.1 }, reveal: 6 },
    behind: true,
    seen: false,
  },
];
test.each(cases)("actual hunt awareness uses $name", async ({ senses, behind, seen }) => {
  const shard = source(senses);
  if (behind) shard.spawn.z = 14;
  const original = JSON.stringify(shard),
    sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  try {
    for (let tick = 0; tick < 3; tick++) sim.host.step();
    expect(memory(sim.host).sensed).toBe(seen);
    expect(memory(sim.host).awareness > 0).toBe(seen);
    if (senses.sight?.range === 12 && senses.sight.cone === 0.3 && !behind)
      expect(memory(sim.host).awareness).toBeCloseTo(0.02125, 10);
    expect(JSON.stringify(shard)).toBe(original);
  } finally {
    sim.dispose();
  }
});

test("actual hunt sight is blocked by its real physics wall", async () => {
  const sim = createShardfileSim(source({ notice: 0, sight: { range: 12, cone: 1 } }), new Map(), {
    rapier: await rapier,
  });
  try {
    sim.host.scope.run(() =>
      addPiece(sim.host.physics, {
        id: "hunt.wall",
        name: "Wall",
        category: "props",
        file: "test/layer-hunt-senses.test.ts",
        colliders: [{ kind: "box", x: 0, y: 1.5, z: 4, hx: 2, hy: 1.5, hz: 0.2 }],
      }),
    );
    sim.host.physics.step();
    for (let tick = 0; tick < 3; tick++) sim.host.step();
    expect(memory(sim.host).sensed).toBe(false);
  } finally {
    sim.dispose();
  }
});

test("authored hunt sight uses its grazing range during actual native grazing", async () => {
  const shard = source({ notice: 0, sight: { range: 12, cone: 1, graze: 6 } }),
    species = shard.rows.species[0];
  if (species?.temperament === undefined) throw new Error("Missing actual grazer source");
  species.aggressive = false;
  species.temperament.reaction = "passive";
  shard.spawn.z = -40;
  shard.rows = parseRows(shard.rows);
  const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  try {
    const actor = sim.host.entities.get("fixture.actor"),
      player = sim.host.players.get("actor.player");
    if (actor === undefined || player === undefined)
      throw new Error("Missing actual grazing participants");
    for (let tick = 0; tick < 1800 && actor.state !== "graze"; tick++) sim.host.step();
    expect(actor.state).toBe("graze");
    player.position.set(
      actor.position.x + Math.sin(actor.yaw) * 7,
      0,
      actor.position.z + Math.cos(actor.yaw) * 7,
    );
    player.motor.resetAt(player.position);
    for (let tick = 0; tick < 3; tick++) sim.host.step();
    expect(memory(sim.host).sensed).toBe(false);
  } finally {
    sim.dispose();
  }
});

test("actual hunt hearing retains native noise smoothing and detects raw sprint input", async () => {
  const shard = source({
    notice: 0,
    sight: { range: 0.01, cone: 0.1 },
    hearing: { still: 0.1, crouch: 0.2, walk: 0.3, sprint: 20 },
  });
  shard.spawn.z = 14;
  const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  try {
    const player = sim.host.players.get("actor.player");
    if (player === undefined) throw new Error("Missing actual hunt hearing player");
    for (let tick = 0; tick < 3; tick++) sim.host.step();
    expect(memory(sim.host).sensed).toBe(false);
    const commands = new Map([
      [
        player.id,
        {
          moveX: 0,
          moveZ: 1,
          yaw: 0,
          commandVersion: 1 as const,
          steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 },
          sprint: true,
        },
      ],
    ]);
    for (let tick = 0; tick < 60; tick++) sim.host.step(commands);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeGreaterThan(5.2);
    expect(memory(sim.host).sensed).toBe(true);
    expect(memory(sim.host).awareness).toBeGreaterThan(0);
  } finally {
    sim.dispose();
  }
});
