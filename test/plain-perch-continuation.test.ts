import { readFileSync } from "node:fs";

import { Vector3 } from "three";
import { expect, test, vi } from "vitest";

import {
  createShardfileSim,
  prepareShardfileSimRestore,
  type ShardfileSimulation,
} from "../src/server/game/plugin/simulation";
import { Rng } from "@wildshard/format/seededRng";
import { Bodies } from "../src/shared/engine/physics/bodies";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { leadCommands, leadPlayer } from "../src/shared/engine/sim/leadPlayer";
import { shardRows } from "../src/shared/engine/sim/shardRows";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { perchFixture } from "./fixtures/plain-perch";
import { createNativeHunt, createNativeSpeciesContext } from "../src/server/game/plugin/brain";
import { flatPopulationEnvironment } from "./fixtures/population-environment";
import { populationEnvironment } from "../src/server/game/population/environment";
import { preparePerchBody } from "../src/server/game/population/perchBody";
import { ReturnProgram } from "../src/shared/game/population/returnProgram";
import { stepPerchBodyRoot } from "../src/shared/game/population/perchRoot";
import { installPerchBodyPools } from "../src/server/game/shardfile/perchBodyPools";

const command = (sim: ShardfileSimulation) => ({
  moveX: leadPlayer(sim.host).health.attributes.health < 100 ? 1 : 0,
  moveZ: 0,
  yaw: 0,
});
const step = (sim: ShardfileSimulation, input = command(sim)) =>
  sim.host.step(leadCommands(sim.host, input));
const visible = (sim: ShardfileSimulation) =>
  [...shardRows(sim.host).bodies.values()].some((read) => read().enabled);

test("default body matches the original trusted native observation owner with one controller", async () => {
  const shard = perchFixture(),
    row = shard.creatures.perchBodies?.[0],
    bite = shard.rows.strikes[0];
  if (row === undefined || bite === undefined) throw Error("Missing native control");
  shard.spawn.z = 7;
  bite.tags = ["creature.fixture.label", "feel.blow", "cover.checked"];
  const rapier = await loadRapier(readFileSync("public/assets/physics/rapier.wasm")),
    assets = new Map<string, Uint8Array>();
  const plain = createShardfileSim(shard, assets, { rapier });
  let native: ShardfileSimulation | undefined;
  try {
    native = createShardfileSim(shard, assets, {
      rapier,
      brains: {
        perchHunter: (actor, host) => {
          const rng = host.rng.stream("spawn");
          flatPopulationEnvironment(host);
          const { hunt } = createNativeHunt(
            host,
            {
              limit: 64,
              fight: {},
              player: "host",
              bands: null,
              hit: { namespace: "fixture", tags: [] },
            },
            {
              rng,
              ground: populationEnvironment(host, "fixture.habitat"),
              nav: null,
              species: new Map(),
            },
          );
          const pools = installPerchBodyPools(host, [row], shard.rows);
          const world = {
            perches: row.sites.map((site) => new Vector3(...site.at)),
            perchBases: row.sites.map((site) => new Vector3(...site.base)),
            throwCoconut: (from: Vector3, to: Vector3, source: typeof actor) => {
              pools.throw(row.id, from, to, source, rng);
            },
          };
          const { observation } = createNativeSpeciesContext(
            {
              host,
              hunt,
              rng,
              world,
              heightAt: (x, z) => host.groundHeightAt(x, z),
              waterLevel: -1,
            },
            actor,
            null,
          );
          const strike = { ...bite, weight: () => bite.weight, motion: { speed: bite.speed } };
          const body = preparePerchBody(
            actor,
            observation,
            strike,
            ReturnProgram.native(host, row.program),
            row.policy,
            observation.attackRandom,
          );
          return {
            observe: (dt) => {
              observation.dt = dt;
              return body.observe(observation);
            },
            body: (dt) => {
              observation.dt = dt;
              stepPerchBodyRoot(actor, dt, row.policy.root);
              body.brain.act(observation);
            },
          };
        },
      },
    });
    expect(plain.host.bodyBands).toEqual(native.host.bodyBands);
    expect(plain.host.rng.snapshot()).toEqual(native.host.rng.snapshot());
    for (let tick = 0; tick < 360; tick++) {
      const input = command(plain);
      step(plain, input);
      step(native, input);
      expect(
        plain.host.entities.get("fixture.actor")?.snapshot(),
        `native parity tick ${tick}`,
      ).toEqual(native.host.entities.get("fixture.actor")?.snapshot());
      expect(leadPlayer(plain.host).health.attributes.health, `native health tick ${tick}`).toBe(
        leadPlayer(native.host).health.attributes.health,
      );
    }
    expect(plain.host.entities.get("fixture.actor")?.snapshot()).toEqual(
      native.host.entities.get("fixture.actor")?.snapshot(),
    );
    expect(leadPlayer(plain.host).health.attributes.health).toBe(
      leadPlayer(native.host).health.attributes.health,
    );
    expect(plain.host.rng.snapshot()).toEqual(native.host.rng.snapshot());
  } finally {
    native?.dispose();
    plain.dispose();
  }
});

for (const phase of ["throw", "drop", "land", "bite", "return", "climb", "perched"] as const)
  test(`actual default ${phase} continuation restores all native state and replays identical input`, async () => {
    const shard = perchFixture();
    shard.spawn =
      phase === "throw" ? { x: -10, y: 0, z: -10, yaw: 0 } : { x: 0, y: 0, z: 7, yaw: 0 };
    const original = JSON.stringify(shard),
      assets = new Map<string, Uint8Array>();
    const rapier = await loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
    const sim = createShardfileSim(shard, assets, { rapier });
    let restored: ShardfileSimulation | undefined;
    try {
      if (phase === "throw") sim.host.addPlayer("fixture.peer", { x: 8, y: 0, z: 7 });
      const actor = sim.host.entities.get("fixture.actor");
      if (actor === undefined) throw Error("Missing actual body");
      const hits: {
        stamp: number;
        move: string | undefined;
        amount: number;
      }[] = [];
      const audit = (value: ShardfileSimulation, out: typeof hits) => {
        const source = value.host.entities.get("fixture.actor");
        if (source === undefined) throw Error("Missing actual replay source");
        value.host.events.on(
          "damage.dealt",
          ({ req, dealt }) => {
            if (req.source === source.combatActor() && req.target === leadPlayer(value.host).health)
              out.push({
                stamp: source.attackStamp,
                move: req.moveId,
                amount: dealt,
              });
          },
          value.host.scope,
        );
      };
      audit(sim, hits);
      let found = false,
        climbed = false;
      for (let tick = 0; tick < 700; tick++) {
        step(sim);
        climbed ||= actor.mem["climb"] === 1;
        found =
          phase === "throw"
            ? visible(sim)
            : phase === "drop"
              ? actor.mem["drop"] === 1 && actor.yOffset > 0 && actor.yOffset < 5
              : phase === "land"
                ? (actor.mem["land"] ?? 0) > 0
                : phase === "bite"
                  ? actor.mem["st"] === 2 && actor.mem["bite"] === 1 && actor.attackPhase > 0
                  : phase === "return"
                    ? actor.mem["st"] === 5
                    : phase === "climb"
                      ? actor.mem["climb"] === 1 && actor.yOffset > 0
                      : climbed && actor.mem["st"] === 0 && actor.mem["climb"] === 0;
        if (found) break;
      }
      expect(found, `Native input did not reach ${phase}`).toBe(true);
      if (phase === "throw") step(sim); // The shot crosses the actual native physics boundary.
      const saved = snapshotSimHost(sim.host),
        prepared = prepareShardfileSimRestore(shard, assets, { rapier });
      restored = prepared.simulation;
      const spawn = vi.spyOn(Bodies.prototype, "spawn"),
        random = vi.spyOn(Rng.prototype, "next");
      try {
        prepared.restore(saved);
        expect(spawn).not.toHaveBeenCalled();
        expect(random).not.toHaveBeenCalled();
      } finally {
        spawn.mockRestore();
        random.mockRestore();
      }
      expect(snapshotSimHost(restored.host)).toEqual(saved);
      const before = hits.length,
        replayed: typeof hits = [];
      audit(restored, replayed);
      for (let tick = 0; tick < 150; tick++) {
        const input = command(sim);
        step(sim, input);
        step(restored, input);
      }
      expect(snapshotSimHost(restored.host)).toEqual(snapshotSimHost(sim.host));
      expect(replayed).toEqual(hits.slice(before));
      expect(JSON.stringify(shard)).toBe(original);
      if (phase === "throw")
        expect(sim.host.players.get("fixture.peer")?.health.attributes.health).toBeLessThan(100);
      else {
        expect(100 - leadPlayer(sim.host).health.attributes.health).toBe(
          hits.reduce((total, hit) => total + hit.amount, 0),
        );
        const bites = hits.filter((hit) => hit.move === "fixture.bite");
        expect(bites.every((hit) => hit.amount === 7)).toBe(true);
        expect(new Set(bites.map((hit) => hit.stamp)).size).toBe(bites.length);
        if (phase === "return" || phase === "climb" || phase === "perched")
          expect(bites.length).toBeGreaterThan(0);
      }
    } finally {
      restored?.dispose();
      sim.dispose();
    }
  });

test.each([
  { sameGroup: true, sameBody: true },
  { sameGroup: false, sameBody: true },
  { sameGroup: true, sameBody: false },
])(
  "native troop death uses explicit social and catalogue scope; group=$sameGroup body=$sameBody",
  async ({ sameGroup, sameBody }) => {
    const shard = perchFixture(),
      spawn = shard.creatures.spawns[0],
      body = shard.creatures.perchBodies?.[0];
    if (spawn === undefined || body === undefined) throw Error("Missing actual social fixture");
    spawn.group = "fixture.troop";
    shard.spawn.z = 30;
    if (!sameBody) {
      const second = structuredClone(body);
      second.id = "fixture.other";
      second.sites = [{ at: [20, 5, 7], base: [20, 0, 7] }];
      shard.creatures.perchBodies?.push(second);
    }
    shard.creatures.spawns.push({
      ...spawn,
      id: "fixture.companion",
      group: sameGroup ? "fixture.troop" : "fixture.other.troop",
      perchBody: sameBody ? body.id : "fixture.other",
      at: sameBody ? [1, 0, 7] : [20, 0, 7],
      home: { x: sameBody ? 1 : 20, y: 0, z: 7, r: 45 },
    });
    const rapier = await loadRapier(readFileSync("public/assets/physics/rapier.wasm")),
      sim = createShardfileSim(shard, new Map(), { rapier });
    try {
      for (let tick = 0; tick < 6; tick++) sim.host.step();
      const actor = sim.host.entities.get("fixture.actor"),
        other = sim.host.entities.get("fixture.companion");
      if (actor === undefined || other === undefined) throw Error("Missing native troop");
      const home = [actor.mem["px"], actor.mem["pz"], actor.mem["perchH"]];
      sim.host.combat.hit({
        source: "env",
        sourceTags: [],
        target: other.combatActor(),
        amount: other.maxHp + 1,
        point: other.position.clone(),
        dir: new Vector3(),
      });
      expect(other.alive).toBe(false);
      for (let tick = 0; tick < 6; tick++) sim.host.step();
      expect(actor.mem["fled"]).toBe(sameGroup && sameBody ? 1 : 0);
      // The real catalogue has no alternate site; it keeps its own original home.
      expect([actor.mem["px"], actor.mem["pz"], actor.mem["perchH"]]).toEqual(home);
      expect(actor.mem["perch"]).toBe(0);
      expect(actor.mem["fleeTo"] ?? 0).toBe(0);
    } finally {
      sim.dispose();
    }
  },
);
