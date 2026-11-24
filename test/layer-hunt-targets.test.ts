import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { array, boolean, parse, object, looseObject, optional, nullable, string, number } from "valibot";
import { HuntTuningSchema } from "@wildshard/format/speciesPrograms";
import { liveSection } from "./fixtures/livePin";
import { Vector3 } from "three";
import {
  createShardfileSim,
  prepareShardfileSimRestore,
  bindShardfileSim,
} from "../src/server/game/plugin/simulation";
import { createSimHost } from "../src/server/engine/sim";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { Rng } from "@wildshard/format/seededRng";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { huntFixture } from "./fixtures/layer-hunt";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
const senses = { notice: 12, sight: { range: 12, cone: 0.6 } };

test("actual sensed hunt chooses the visible second player and keeps native damage ownership", async () => {
  const shard = huntFixture(senses);
  shard.spawn.z = 8;
  const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  try {
    const second = sim.host.addPlayer("actual.second", { x: 0, y: 0, z: 5 }),
      actor = sim.host.entities.get("fixture.actor");
    if (actor === undefined) throw new Error("Missing actual hunt actor");
    const hits: { player: string; source: unknown; amount: number }[] = [];
    sim.host.events.on(
      "damage.dealt",
      ({ req }) => {
        if (sim.host.players.has(req.target.id))
          hits.push({ player: req.target.id, source: req.source, amount: req.amount });
      },
      sim.host.scope,
    );
    for (let tick = 0; tick < 300 && hits.length === 0; tick++) sim.host.step();
    expect(hits).toEqual([
      { player: second.id, source: actor.combatActor(), amount: actor.mods.chargeDamage },
    ]);
    expect(sim.host.players.get("actor.player")?.health.attributes.health).toBe(100);
  } finally {
    sim.dispose();
  }
});

test("native hunt retains its acquired target over a nearer hidden seat and restores before contact", async () => {
  const shard = huntFixture(senses);
  shard.spawn.z = 5;
  const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
  try {
    const actor = sim.host.entities.get("fixture.actor");
    if (actor === undefined) throw new Error("Missing native charge body");
    sim.host.step();
    expect(actor.state).toBe("charge");
    const hidden = sim.host.addPlayer("actual.hidden", {
      x: actor.position.x,
      y: 0,
      z: actor.position.z + 0.5,
    });
    const saved = snapshotSimHost(sim.host);
    resumed.restore(saved);
    for (let tick = 0; tick < 90; tick++) {
      sim.host.step();
      resumed.host.step();
    }
    expect(hidden.health.attributes.health).toBe(100);
    expect(sim.host.players.get("actor.player")?.health.attributes.health).toBeLessThan(100);
    expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
  } finally {
    resumed.host.dispose();
    sim.dispose();
  }
});

test.each([false, true])(
  "actual hunt keeps its three native preparation draws and restores without RNG, sensed=%s",
  async (sensed) => {
    const shard = huntFixture(sensed ? senses : undefined),
      bytes = JSON.stringify(shard);
    const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
    try {
      for (let tick = 0; tick < 37; tick++) sim.host.step();
      const saved = snapshotSimHost(sim.host),
        random = vi.spyOn(Rng.prototype, "next");
      const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
      try {
        expect(random).toHaveBeenCalledTimes(3);
        random.mockClear();
        resumed.restore(saved);
        expect(random).not.toHaveBeenCalled();
        random.mockRestore();
        expect(snapshotSimHost(resumed.host)).toEqual(saved);
        for (let tick = 0; tick < 90; tick++) {
          sim.host.step();
          resumed.host.step();
        }
        expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
        expect(JSON.stringify(shard)).toBe(bytes);
      } finally {
        random.mockRestore();
        resumed.host.dispose();
      }
    } finally {
      sim.dispose();
    }
  },
);

test("a neutral hunt keeps the actual provoking player behind its cone through continuation", async () => {
  const shard = huntFixture({ notice: 0, sight: { range: 0.01, cone: 0.1 } }),
    species = shard.rows.species[0];
  if (species?.temperament === undefined) throw new Error("Missing neutral source");
  species.temperament.reaction = "neutral";
  shard.spawn.z = 8;
  const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
  try {
    const actor = sim.host.entities.get("fixture.actor"),
      player = sim.host.players.get("actor.player");
    if (actor === undefined || player === undefined)
      throw new Error("Missing actual provocation participants");
    const bystander = sim.host.addPlayer("actual.bystander", { x: 0, y: 0, z: 6.5 });
    for (let tick = 0; tick < 3; tick++) sim.host.step();
    expect(player.health.attributes.health).toBe(100);
    sim.host.combat.hit({
      source: player.health,
      sourceTags: ["actual.player.hit"],
      target: actor.combatActor(),
      amount: 1,
      point: actor.position.clone(),
      dir: new Vector3(0, 0, -1),
    });
    resumed.restore(snapshotSimHost(sim.host));
    for (let tick = 0; tick < 120; tick++) {
      sim.host.step();
      resumed.host.step();
    }
    expect(player.health.attributes.health).toBeLessThan(100);
    expect(bystander.health.attributes.health).toBe(100);
    expect(bystander.health.attributes.health).toBe(100);
    expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
  } finally {
    resumed.host.dispose();
    sim.dispose();
  }
});

test("omitted-sensing hunt restores its original unbanded native continuation and phase", async () => {
  const shard = huntFixture(),
    R = await rapier,
    basis = createShardfileSim(shard, new Map(), { rapier: R });
  const host = createSimHost(basis.host.level, { rapier: R });
  const legacy = bindShardfileSim(host, shard, new Map(), { rapier: R, brains: {} });
  const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: R });
  try {
    for (let tick = 0; tick < 5; tick++) legacy.host.step();
    const saved = snapshotSimHost(legacy.host);
    expect(saved.bands).toBeUndefined();
    expect(saved.adapters.some((row) => row.id === "creatures.senses")).toBe(false);
    resumed.restore(saved);
    for (let tick = 0; tick < 120; tick++) {
      legacy.host.step();
      resumed.host.step();
    }
    const modern = snapshotSimHost(resumed.host);
    delete modern.bands;
    expect(modern).toEqual(snapshotSimHost(legacy.host));
  } finally {
    resumed.host.dispose();
    legacy.dispose();
    basis.dispose();
  }
});

test.each(["boar", "elk"] as const)(
  "omitted sensing retains live Pine %s tuning, awareness and exact memory continuation",
  async (kind) => {
    // ZONE-SNAPSHOTS ZS9 (J507): Pine r16's live declared species row for the kind (its first: the plain boar or elk).
    const pine = parse(
      object({ rows: object({ species: array(looseObject({ kind: string(), aggressive: optional(boolean()), temperament: looseObject({ tuning: looseObject({}) }) })) }) }),
      liveSection("pine-hollow", "actors/species"),
    ).rows.species.find((row) => row.kind === kind);
    if (pine === undefined) throw new Error(`Pine declares no ${kind}`);
    // The declared row carries the species motion beside its hunt tuning (declaredNative.ts splits them).
    const { motion: _motion, ...hunt } = pine.temperament.tuning, tuning = parse(HuntTuningSchema, hunt);
    const shard = huntFixture(),
      species = shard.rows.species[0];
    if (species?.temperament === undefined || false)
      throw new Error("Missing original Pine tuning");
    species.aggressive = pine.aggressive ?? false;
    species.temperament.reaction = species.aggressive ? "aggressive" : "passive";
    species.temperament.tuning = tuning;
    shard.spawn.z = -13; // twenty metres away, outside either native panic distance
    const bytes = JSON.stringify(shard),
      sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
    const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
    try {
      for (let tick = 0; tick < 3; tick++) sim.host.step();
      const saved = sim.host.adapters.get("brain.fixture.actor")?.snapshot();
      if (typeof saved !== "string") throw new Error("Missing original native hunt state");
      const native = parse(
        object({ contract: string(), memory: object({ awareness: number() }) }),
        JSON.parse(saved),
      );
      const contract = parse(
        object({ species: object({ tuning: HuntTuningSchema }) }),
        JSON.parse(native.contract),
      );
      expect(JSON.stringify(contract.species.tuning)).toBe(JSON.stringify(tuning));
      // Captured from the unchanged native path before target/restore edits;
      // Rapier feet settling is part of this exact awareness continuation.
      expect(native.memory.awareness).toBe(
        kind === "boar" ? 0.00818186070324209 : 0.014000024945902025,
      );
      expect(JSON.parse(saved)).not.toHaveProperty("target");
      expect(sim.host.adapters.has("creatures.senses")).toBe(false);
      const player = sim.host.players.get("actor.player"),
        actor = sim.host.entities.get("fixture.actor");
      if (player === undefined || actor === undefined)
        throw new Error("Missing real Pine-tuned hunt participants");
      const commands = new Map([
        [
          player.id,
          {
            moveX: 0,
            moveZ: 1,
            yaw: Math.PI,
            commandVersion: 1 as const,
            steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 },
            sprint: true,
          },
        ],
      ]);
      let reacted = false;
      for (let tick = 0; tick < 300; tick++) {
        sim.host.step(commands);
        reacted ||= actor.state === "flee" || actor.state === "charge" || actor.state === "stalk";
      }
      expect(reacted).toBe(true);
      resumed.restore(snapshotSimHost(sim.host));
      for (let tick = 0; tick < 120; tick++) {
        sim.host.step(commands);
        resumed.host.step(commands);
      }
      expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
      expect(JSON.stringify(shard)).toBe(bytes);
    } finally {
      resumed.host.dispose();
      sim.dispose();
    }
  },
);

test.each([false, true])(
  "prepared hunt can keep its exact fresh native state, sensed=%s",
  async (sensed) => {
    const shard = huntFixture(sensed ? senses : undefined),
      R = await rapier;
    const original = createShardfileSim(shard, new Map(), { rapier: R });
    const prepared = prepareShardfileSimRestore(shard, new Map(), { rapier: R });
    try {
      expect(prepared.keep()).toBe(prepared.host);
      expect(snapshotSimHost(prepared.host)).toEqual(snapshotSimHost(original.host));
      for (let tick = 0; tick < 90; tick++) {
        original.host.step();
        prepared.host.step();
      }
      expect(snapshotSimHost(prepared.host)).toEqual(snapshotSimHost(original.host));
    } finally {
      prepared.host.dispose();
      original.dispose();
    }
  },
);

test("a sensed hunt refuses missing or foreign saved target authority", async () => {
  const shard = huntFixture(senses);
  shard.spawn.z = 5;
  const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  try {
    sim.host.step();
    const saved = snapshotSimHost(sim.host);
    for (const target of [undefined, "foreign.player"]) {
      const corrupted = structuredClone(saved),
        row = corrupted.adapters.find((entry) => entry.id === "brain.fixture.actor");
      if (typeof row?.state !== "string") throw new Error("Missing hunt target continuation");
      const state = parse(
        looseObject({ target: optional(nullable(string())) }),
        JSON.parse(row.state),
      );
      if (target === undefined) delete state.target;
      else state.target = target;
      row.state = JSON.stringify(state);
      const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
      try {
        expect(() => resumed.restore(corrupted)).toThrow(
          "Incompatible sensed hunt target continuation",
        );
      } finally {
        resumed.host.dispose();
      }
    }
  } finally {
    sim.dispose();
  }
});
