import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import type { CreatureSenses } from "@wildshard/format/creatureLayers";
import { parseRows } from "@wildshard/format/rows";
import {
  createShardfileSim,
  bindShardfileSim,
  prepareShardfileSimRestore,
} from "../src/server/game/plugin/simulation";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { createSimHost } from "../src/server/engine/sim";
import { dataCreaturePorts } from "../src/shared/game/shardfile/dataCreaturePorts";
import { dataGroundBrains } from "../src/server/game/shardfile/dataGroundBrains";
import { dataPerchBrains } from "../src/server/game/shardfile/dataPerchBrains";
import { Rng } from "@wildshard/format/seededRng";
import { Bodies } from "../src/shared/engine/physics/bodies";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { aliases, canonical, fixture, requireBrain } from "./fixtures/plain-brain-roster";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
const declarations = [
  ...canonical.map((brain) => ({ name: brain?.kind ?? "missing", brain })),
  ...aliases.map(([kind, name, pattern]) => ({
    name: `${name}/${pattern}`,
    brain: { ...requireBrain(kind), kind: name, pattern },
  })),
];
function source(brain: unknown, sensed = true) {
  const shard = fixture(brain),
    species = shard.rows.species[0];
  if (species === undefined) throw new Error("Missing actual sensed species");
  species.temperament = {
    brain: "fixture.brain",
    reaction: "aggressive",
    leash: 200,
    assist: 0,
    home: { speed: 2, stop: 0.5 },
  };
  if (sensed)
    species.senses = {
      notice: 12,
      sight: { range: 12, cone: 0.6, graze: 7 },
      hearing: { still: 1, crouch: 2, walk: 3, sprint: 12 },
      reveal: 1,
    };
  shard.rows = parseRows(shard.rows);
  return shard;
}
const edits: { field: string; change: (senses: CreatureSenses) => void }[] = [
  {
    field: "notice",
    change: (senses) => {
      senses.notice += 1;
    },
  },
  {
    field: "sight.range",
    change: (senses) => {
      if (senses.sight) senses.sight.range += 1;
    },
  },
  {
    field: "sight.cone",
    change: (senses) => {
      if (senses.sight) senses.sight.cone += 0.1;
    },
  },
  {
    field: "sight.graze",
    change: (senses) => {
      if (senses.sight) senses.sight.graze = 8;
    },
  },
  {
    field: "hearing.still",
    change: (senses) => {
      if (senses.hearing) senses.hearing.still += 1;
    },
  },
  {
    field: "hearing.crouch",
    change: (senses) => {
      if (senses.hearing) senses.hearing.crouch += 1;
    },
  },
  {
    field: "hearing.walk",
    change: (senses) => {
      if (senses.hearing) senses.hearing.walk += 1;
    },
  },
  {
    field: "hearing.sprint",
    change: (senses) => {
      if (senses.hearing) senses.hearing.sprint += 1;
    },
  },
  {
    field: "reveal",
    change: (senses) => {
      senses.reveal = 2;
    },
  },
];

test.each(declarations)(
  "$name refuses changed or missing executable sensing authority",
  async ({ brain }) => {
    const shard = source(brain),
      sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
    try {
      for (let tick = 0; tick < 30; tick++) sim.host.step();
      const saved = snapshotSimHost(sim.host);
      for (const edit of [
        ...edits,
        { field: "missing", change: (_senses: CreatureSenses) => undefined },
      ]) {
        const changed = structuredClone(shard),
          species = changed.rows.species[0];
        if (species?.senses === undefined) throw new Error("Missing source sensing");
        if (edit.field === "missing") delete species.senses;
        else edit.change(species.senses);
        changed.rows = parseRows(changed.rows);
        const resumed = prepareShardfileSimRestore(changed, new Map(), { rapier: await rapier });
        try {
          expect(() => resumed.restore(saved), edit.field).toThrow();
        } finally {
          resumed.host.dispose();
        }
      }
    } finally {
      sim.dispose();
    }
  },
);

test.each(declarations)(
  "$name prepares/restores sensed owners with no RNG, spawn or source mutation",
  async ({ brain }) => {
    const shard = source(brain),
      bytes = JSON.stringify(shard),
      sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
    try {
      sim.host.addPlayer("actual.second", { x: 0, y: 0, z: 6 });
      for (let tick = 0; tick < 37; tick++) sim.host.step();
      const saved = snapshotSimHost(sim.host),
        random = vi.spyOn(Rng.prototype, "next"),
        spawn = vi.spyOn(Bodies.prototype, "spawn");
      const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
      try {
        // Construction may create restore placeholders, but it never rolls AI,
        // runs a body recipe or performs a gameplay spawn.
        expect(random).not.toHaveBeenCalled();
        expect(spawn).not.toHaveBeenCalled();
        resumed.restore(saved);
        expect(random).not.toHaveBeenCalled();
        expect(spawn).not.toHaveBeenCalled();
        random.mockRestore();
        spawn.mockRestore();
        expect(snapshotSimHost(resumed.host)).toEqual(saved);
        for (let tick = 0; tick < 90; tick++) {
          sim.host.step();
          resumed.host.step();
        }
        expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
        expect(JSON.stringify(shard)).toBe(bytes);
      } finally {
        random.mockRestore();
        spawn.mockRestore();
        resumed.host.dispose();
      }
    } finally {
      sim.dispose();
    }
  },
);

test.each(canonical)(
  "$kind keeps compatible no-senses native saves and phase without adding perception state",
  async (brain) => {
    const shard = source(brain, false),
      R = await rapier,
      assets = new Map<string, Uint8Array>();
    const basis = createShardfileSim(shard, assets, { rapier: R });
    const host = createSimHost(basis.host.level, { rapier: R });
    const data = dataCreaturePorts(host, shard.rows, shard.creatures.spawns);
    const legacy = bindShardfileSim(host, shard, assets, {
      rapier: R,
      brains: {
        ...data.brains,
        ...dataGroundBrains(host, shard.rows, shard.creatures.spawns),
        ...dataPerchBrains(host, shard, assets),
      },
    });
    data.install();
    const resumed = prepareShardfileSimRestore(shard, assets, { rapier: R });
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
      // Interest scheduling is an additive owner; every original continuation
      // value, body, health, native physics and random stream stays equal.
      delete modern.bands;
      expect(modern).toEqual(snapshotSimHost(legacy.host));
    } finally {
      resumed.host.dispose();
      legacy.dispose();
      basis.dispose();
    }
  },
);

test("sensed native target continuation refuses absent and foreign player authority", async () => {
  const shard = source(requireBrain("patrol-diver")),
    sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  try {
    sim.host.addPlayer("actual.second", { x: 0, y: 0, z: 6 });
    for (let tick = 0; tick < 30; tick++) sim.host.step();
    const saved = snapshotSimHost(sim.host);
    for (const corrupt of ["missing source", "missing target", "foreign target"]) {
      const changed = structuredClone(saved),
        row = changed.adapters.find((entry) => entry.id === "brain.fixture.actor");
      if (row === undefined || !Array.isArray(row.state) || row.state.length !== 3)
        throw new Error("Missing native sensed target state");
      if (corrupt === "missing source")
        changed.adapters = changed.adapters.filter((entry) => entry.id !== "creatures.senses");
      else if (corrupt === "missing target") row.state.pop();
      else row.state[2] = "foreign.player";
      const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
      try {
        expect(() => resumed.restore(changed), corrupt).toThrow();
      } finally {
        resumed.host.dispose();
      }
    }
  } finally {
    sim.dispose();
  }
});
