import { readFileSync } from "node:fs";
import { Vector3 } from "three";
import { expect, test, vi } from "vitest";
import {
  createShardfileSim,
  bindShardfileSim,
  prepareShardfileSimRestore,
} from "../src/server/game/plugin/simulation";
import { createSimHost } from "../src/server/engine/sim";
import { SkirmisherBrain } from "../src/server/engine/ai/skirmisher";
import { dataGroundBrains } from "../src/server/game/shardfile/dataGroundBrains";
import { dataCreaturePorts } from "../src/shared/game/shardfile/dataCreaturePorts";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { groundFixture } from "./fixtures/plain-ground";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
function fixture(distance = 80) {
  const source = groundFixture(true),
    temperament = source.rows.species[0]?.temperament;
  if (temperament === undefined) throw new Error("Missing actual layer");
  temperament.leash = 200;
  source.spawn.z = 7 + distance;
  return source;
}

test("default layers use the actual host bands and four-tick far decisions", async () => {
  const sim = createShardfileSim(fixture(), new Map(), { rapier: await rapier });
  const think = vi.spyOn(SkirmisherBrain.prototype, "think");
  try {
    expect(sim.host.bodyBands).toBeDefined();
    for (let tick = 1; tick <= 24; tick++) {
      sim.host.step();
      expect(think.mock.calls.filter(([ports]) => ports.dt > 0)).toHaveLength(Math.floor(tick / 4));
    }
  } finally {
    think.mockRestore();
    sim.dispose();
  }
});

test("an absent player sleeps a real body without RNG or contact work and re-entry never catches up", async () => {
  const sim = createShardfileSim(fixture(5), new Map(), { rapier: await rapier });
  const think = vi.spyOn(SkirmisherBrain.prototype, "think");
  try {
    sim.host.step();
    sim.host.parked.add("actor.player");
    const body = sim.host.entities.get("fixture.actor"),
      rng = sim.host.rng.snapshot();
    if (body === undefined) throw new Error("Missing actual sleeping body");
    const before = body.snapshot();
    think.mockClear();
    for (let tick = 0; tick < 600; tick++) sim.host.step();
    expect(think).not.toHaveBeenCalled();
    expect(body.snapshot()).toEqual(before);
    expect(sim.host.rng.snapshot()).toEqual(rng);
    expect(sim.host.nearestPlayer(body.position).health.attributes.health).toBe(100);
    sim.host.parked.delete("actor.player");
    for (let tick = 0; tick < 6; tick++) sim.host.step();
    expect(think.mock.calls.filter(([ports]) => ports.dt > 0)).toHaveLength(2);
    for (const [ports] of think.mock.calls) expect(ports.dt).toBeLessThanOrEqual(3 / 60);
  } finally {
    think.mockRestore();
    sim.dispose();
  }
});

test("a parked lead cannot put the actual second player to sleep", async () => {
  const sim = createShardfileSim(fixture(200), new Map(), { rapier: await rapier });
  const think = vi.spyOn(SkirmisherBrain.prototype, "think");
  try {
    sim.host.parked.add("actor.player");
    sim.host.addPlayer("actual.second", { x: 0, y: 0, z: 12 });
    for (let tick = 0; tick < 12; tick++) sim.host.step();
    expect(think.mock.calls.filter(([ports]) => ports.dt > 0)).toHaveLength(4);
    expect(sim.host.entities.get("fixture.actor")?.mem["init"]).toBe(1);
  } finally {
    think.mockRestore();
    sim.dispose();
  }
});

test("real damage wakes once off cadence and exact restore retains the consumed wake", async () => {
  const source = fixture(),
    sim = createShardfileSim(source, new Map(), { rapier: await rapier });
  const resumed = prepareShardfileSimRestore(source, new Map(), { rapier: await rapier });
  const think = vi.spyOn(SkirmisherBrain.prototype, "think");
  try {
    sim.host.step();
    const actor = sim.host.entities.get("fixture.actor");
    if (actor === undefined) throw new Error("Missing actual damaged body");
    const player = sim.host.nearestPlayer(actor.position);
    sim.host.combat.hit({
      source: player.health,
      sourceTags: [],
      target: actor.combatActor(),
      amount: 1,
      point: actor.position.clone(),
      dir: new Vector3(),
    });
    think.mockClear();
    sim.host.step();
    expect(think.mock.calls.filter(([ports]) => ports.dt > 0)).toHaveLength(1);
    resumed.restore(snapshotSimHost(sim.host));
    think.mockClear();
    sim.host.step();
    resumed.host.step();
    expect(think.mock.calls.filter(([ports]) => ports.dt > 0)).toHaveLength(0);
    expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
    for (let tick = 0; tick < 48; tick++) {
      sim.host.step();
      resumed.host.step();
    }
    expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
  } finally {
    think.mockRestore();
    resumed.host.dispose();
    sim.dispose();
  }
});

test("a legacy unbanded layer save keeps native phase on migration without rerunning work", async () => {
  const source = fixture(5),
    R = await rapier,
    basis = createShardfileSim(source, new Map(), { rapier: R });
  const host = createSimHost(basis.host.level, { rapier: R });
  const data = dataCreaturePorts(host, source.rows, source.creatures.spawns);
  // The actual trusted native seam preserves the previous unbanded host policy.
  const legacy = bindShardfileSim(host, source, new Map(), {
    rapier: R,
    brains: { ...data.brains, ...dataGroundBrains(host, source.rows, source.creatures.spawns) },
  });
  const resumed = prepareShardfileSimRestore(source, new Map(), { rapier: R });
  try {
    for (let tick = 0; tick < 5; tick++) legacy.host.step();
    const saved = snapshotSimHost(legacy.host);
    expect(saved.bands).toBeUndefined();
    const rng = legacy.host.rng.snapshot();
    resumed.restore(saved);
    expect(resumed.host.rng.snapshot()).toEqual(rng);
    expect(resumed.host.bodyBands).toBeDefined();
    for (let tick = 0; tick < 120; tick++) {
      legacy.host.step();
      resumed.host.step();
      expect(resumed.host.entities.get("fixture.actor")?.snapshot()).toEqual(
        legacy.host.entities.get("fixture.actor")?.snapshot(),
      );
      expect(resumed.host.rng.snapshot()).toEqual(legacy.host.rng.snapshot());
    }
  } finally {
    resumed.host.dispose();
    legacy.dispose();
    basis.dispose();
  }
});
