import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseRows } from "@wildshard/format/rows";
import {
  createShardfileSim,
  prepareShardfileSimRestore,
} from "../src/server/game/plugin/simulation";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { aliases, fixture, requireBrain } from "./fixtures/plain-brain-roster";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
const kinds = [
  "ram-grazer",
  "challenge-grazer",
  "orbit-diver",
  "patrol-diver",
  "burst-flyer",
  "perch-hunter",
];
const declarations = kinds.flatMap((kind) => {
  const brain = requireBrain(kind),
    alias = aliases.find((row) => row[0] === kind);
  return [
    { name: kind, brain },
    ...(alias === undefined
      ? []
      : [
          {
            name: `${alias[1]}/${alias[2]}`,
            brain: { ...brain, kind: alias[1], pattern: alias[2] },
          },
        ]),
  ];
});
function source(brain: unknown, hidden = false) {
  const shard = fixture(brain),
    species = shard.rows.species[0];
  if (species === undefined) throw new Error("Missing actual native species");
  species.temperament = {
    brain: "fixture.brain",
    reaction: "aggressive",
    leash: 200,
    assist: 0,
    home: { speed: 2, stop: 0.5 },
  };
  species.senses = { notice: 12, sight: { range: hidden ? 0.01 : 12, cone: 0.6 } };
  shard.rows = parseRows(shard.rows);
  return shard;
}

test.each(declarations)(
  "$name cannot acquire an unseen player through native default ports",
  async ({ brain }) => {
    const shard = source(brain, true),
      sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
    try {
      const actor = sim.host.entities.get("fixture.actor");
      if (actor === undefined) throw new Error("Missing native actor");
      for (let tick = 0; tick < 120; tick++) sim.host.step();
      expect(sim.host.players.get("actor.player")?.health.attributes.health).toBe(100);
      expect(actor.attackPhase).toBeLessThan(0);
      expect(sim.host.attackTargets()).not.toContainEqual([actor.entityId, "actor.player"]);
    } finally {
      sim.dispose();
    }
  },
);

test.each(declarations)(
  "$name contacts the visible second player and restores its actual owners",
  async ({ name, brain }) => {
    const shard = source(brain),
      original = JSON.stringify(shard);
    const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
    const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
    try {
      const second = sim.host.addPlayer("actual.second", { x: 0, y: 0, z: 6 }),
        actor = sim.host.entities.get("fixture.actor");
      if (actor === undefined) throw new Error("Missing actual native actor");
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
      let continued = false;
      for (let tick = 0; tick < 1200 && hits.length === 0; tick++) {
        sim.host.step();
        if (continued) resumed.host.step();
        else if (actor.attackPhase >= 0) {
          resumed.restore(snapshotSimHost(sim.host));
          continued = true;
        }
      }
      expect(continued).toBe(true);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.player).toBe(second.id);
      expect(hits[0]?.source).toBe(actor.combatActor());
      expect(["fixture.bite", "fixture.charge", "fixture.throw"]).toContain(hits[0]?.move);
      expect(second.health.attributes.health).toBe(100 - (hits[0]?.amount ?? 0));
      expect(sim.host.players.get("actor.player")?.health.attributes.health).toBe(100);
      expect(sim.host.attackTargets()).toContainEqual([actor.entityId, second.id]);
      expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
      if (name === "burst-flyer" || name === "diver/burst") {
        expect(second.impulse.y).toBeGreaterThan(0);
        expect(sim.host.players.get("actor.player")?.impulse.lengthSq()).toBe(0);
      }
      for (let tick = 0; tick < 90; tick++) {
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

// Actual version-1 movement drives hearing; neither velocity nor a brain port
// is injected into these default-loader worlds.
test.each(kinds)("%s hears actual sprinting behind a closed visual range", async (kind) => {
  const brain = requireBrain(kind),
    loudSource = source(brain, true),
    quietSource = source(brain, true);
  const species = loudSource.rows.species[0];
  if (species?.senses === undefined) throw new Error("Missing hearing layer");
  species.senses.hearing = { still: 0.1, crouch: 0.2, walk: 0.3, sprint: 12 };
  loudSource.rows = parseRows(loudSource.rows);
  const loud = createShardfileSim(loudSource, new Map(), { rapier: await rapier });
  const quiet = createShardfileSim(quietSource, new Map(), { rapier: await rapier });
  try {
    const actor = loud.host.entities.get("fixture.actor"),
      silent = quiet.host.entities.get("fixture.actor");
    const player = loud.host.players.get("actor.player");
    if (actor === undefined || silent === undefined || player === undefined)
      throw new Error("Missing actual hearing participants");
    let heardUnder = false,
      silentUnder = false;
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
    for (let tick = 0; tick < 12; tick++) {
      loud.host.step(commands);
      quiet.host.step(commands);
      heardUnder ||= (actor.mem["under"] ?? 0) > 0;
      silentUnder ||= (silent.mem["under"] ?? 0) > 0;
    }
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeGreaterThan(5.2);
    if (kind === "perch-hunter") {
      expect(heardUnder).toBe(true);
      expect(silentUnder).toBe(false);
    } else {
      const heard = loud.host.adapters.get("brain.fixture.actor")?.snapshot(),
        unheard = quiet.host.adapters.get("brain.fixture.actor")?.snapshot();
      expect(Array.isArray(heard) ? heard[2] : undefined).toBe(player.id);
      expect(Array.isArray(unheard) ? unheard[2] : undefined).toBe(null);
    }
  } finally {
    loud.dispose();
    quiet.dispose();
  }
});
