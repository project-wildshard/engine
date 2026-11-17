import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseRows } from "@wildshard/format/rows";
import { canonical, fixture } from "./fixtures/plain-brain-roster";
import {
  createShardfileSim,
  prepareShardfileSimRestore,
} from "../src/server/game/plugin/simulation";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { loadRapier } from "../src/shared/engine/physics/rapier";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));

test.each(canonical)(
  "actual layered $kind keeps one body/contact owner through sleep and restore",
  async (declaration) => {
    const source = fixture(declaration),
      row = source.rows.species[0];
    if (row === undefined) throw new Error("Missing actual species");
    row.temperament = {
      brain: "fixture.brain",
      reaction: "aggressive",
      leash: 200,
      assist: 0,
      home: { speed: 2, stop: 0.5 },
    };
    source.rows = parseRows(source.rows);
    const original = JSON.stringify(source),
      sim = createShardfileSim(source, new Map(), { rapier: await rapier });
    const resumed = prepareShardfileSimRestore(source, new Map(), { rapier: await rapier });
    try {
      expect(sim.host.bodyBands).toBeDefined();
      const actor = sim.host.entities.get("fixture.actor");
      if (actor === undefined) throw new Error("Missing actual layered actor");
      for (let tick = 0; tick < 5; tick++) sim.host.step();
      sim.host.parked.add("actor.player");
      const before = actor.snapshot(),
        rng = sim.host.rng.snapshot(),
        health = sim.host.nearestPlayer(actor.position).health.snapshot();
      for (let tick = 0; tick < 60; tick++) sim.host.step();
      expect(actor.snapshot()).toEqual(before);
      expect(sim.host.rng.snapshot()).toEqual(rng);
      expect(sim.host.nearestPlayer(actor.position).health.snapshot()).toEqual(health);
      const saved = snapshotSimHost(sim.host);
      resumed.restore(saved);
      sim.host.parked.delete("actor.player");
      for (let tick = 0; tick < 120; tick++) {
        sim.host.step();
        resumed.host.step();
      }
      expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
      expect(JSON.stringify(source)).toBe(original);
    } finally {
      resumed.host.dispose();
      sim.dispose();
    }
  },
);
