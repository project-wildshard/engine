import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseRows } from "@wildshard/format/rows";
import {
  createShardfileSim,
  prepareShardfileSimRestore,
} from "../src/server/game/plugin/simulation";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { fixture, requireBrain } from "./fixtures/plain-brain-roster";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
const kinds = ["pursue", "skirmisher", "guardian"] as const;
function source(kind: (typeof kinds)[number]) {
  const shard = fixture(requireBrain(kind)),
    species = shard.rows.species[0];
  if (species === undefined) throw new Error("Missing actual grounded species");
  species.temperament = {
    brain: "fixture.brain",
    reaction: "aggressive",
    leash: 200,
    assist: 0,
    home: { speed: 2, stop: 0.5 },
  };
  species.senses = { notice: 12, sight: { range: 12, cone: 0.3 } };
  shard.rows = parseRows(shard.rows);
  shard.spawn = { x: 0, y: 0, z: 8, yaw: 0 }; // one metre behind the actual heading
  return shard;
}

test.each(kinds)("actual %s misses a player behind its authored sight cone", async (kind) => {
  const shard = source(kind),
    sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  try {
    const actor = sim.host.entities.get("fixture.actor");
    if (actor === undefined) throw new Error("Missing actual grounded actor");
    for (let tick = 0; tick < 120; tick++) sim.host.step();
    expect(sim.host.nearestPlayer(actor.position).health.attributes.health).toBe(100);
    expect(actor.attackPhase).toBeLessThan(0);
    if (kind === "guardian") expect(actor.mem["rise"]).toBe(0);
  } finally {
    sim.dispose();
  }
});

test.each(kinds)(
  "actual %s selects and strikes the visible second player through its original owner",
  async (kind) => {
    const shard = source(kind),
      original = JSON.stringify(shard),
      sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
    const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
    try {
      const second = sim.host.addPlayer("actual.second", { x: 0, y: 0, z: 6 }),
        actor = sim.host.entities.get("fixture.actor");
      if (actor === undefined) throw new Error("Missing actual grounded actor");
      const hits: { player: string; move: string | undefined; source: unknown; amount: number }[] =
        [];
      sim.host.events.on(
        "damage.dealt",
        ({ req }) => {
          if (sim.host.players.has(req.target.id))
            hits.push({
              player: req.target.id,
              move: req.moveId,
              source: req.source,
              amount: req.amount,
            });
        },
        sim.host.scope,
      );
      for (let tick = 0; tick < 600 && hits.length === 0; tick++) sim.host.step();
      expect(hits).toEqual([
        { player: second.id, move: "fixture.bite", source: actor.combatActor(), amount: 7 },
      ]);
      expect(sim.host.players.get("actor.player")?.health.attributes.health).toBe(100);
      expect(sim.host.attackTargets()).toContainEqual([actor.entityId, second.id]);
      resumed.restore(snapshotSimHost(sim.host));
      for (let tick = 0; tick < 120; tick++) {
        sim.host.step();
        resumed.host.step();
      }
      expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
      expect(JSON.stringify(shard)).toBe(original);
    } finally {
      resumed.host.dispose();
      sim.dispose();
    }
  },
);

test.each(kinds)("actual %s hears real sprint input behind its cone", async (kind) => {
  const shard = source(kind),
    species = shard.rows.species[0];
  if (species?.senses === undefined) throw new Error("Missing authored senses");
  species.senses.hearing = { still: 0.1, crouch: 0.2, walk: 0.3, sprint: 12 };
  shard.rows = parseRows(shard.rows);
  const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  try {
    const actor = sim.host.entities.get("fixture.actor"),
      player = sim.host.players.get("actor.player");
    if (actor === undefined || player === undefined)
      throw new Error("Missing actual hearing participants");
    for (let tick = 0; tick < 12; tick++)
      sim.host.step(
        new Map([
          [
            player.id,
            {
              moveX: 0,
              moveZ: 1,
              yaw: 0,
              commandVersion: 1,
              steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 },
              sprint: true,
            },
          ],
        ]),
      );
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeGreaterThan(5.2);
    if (kind === "guardian") expect(actor.mem["rise"]).toBeGreaterThan(0);
    else expect(actor.state).not.toBe("idle");
  } finally {
    sim.dispose();
  }
});
