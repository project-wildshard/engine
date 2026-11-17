import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { parse } from "valibot";
import { CreaturesSchema } from "@wildshard/format/creatures";
import { parseRows } from "@wildshard/format/rows";
import { SkirmisherBrain } from "../src/server/engine/ai/skirmisher";
import type { AnimalSim } from "../src/shared/engine/entities/AnimalSim";
import { RamGrazerBrain } from "../src/server/engine/ai/ramGrazer";
import {
  createShardfileSim,
  prepareShardfileSimRestore,
} from "../src/server/game/plugin/simulation";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { groundFixture } from "./fixtures/plain-ground";
import nativeRows from "./fixtures/plain-brain-roster.json";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
const bands = {
  physics: false,
  fixedSteps: true,
  rate: () => "ai",
  rates: {
    ai: {
      bands: [
        { upTo: 60, brainHz: 60, body: "frame" },
        { upTo: 160, brainHz: 15, body: "half" },
        { upTo: Infinity, brainHz: "paused", body: "paused" },
      ],
    },
  },
} as const;

for (const layer of [false, true])
  for (const divisor of [3, 6]) {
    test(`actual skirmisher uses its single band clock; layer=${String(layer)}, divisor=${String(divisor)}`, async () => {
      const source = groundFixture(layer),
        brain = source.creatures.brains[0],
        species = source.rows.species[0];
      if (layer) {
        if (
          species?.temperament?.tuning === undefined ||
          !("thinkDivisor" in species.temperament.tuning)
        )
          throw new Error("Missing layered cadence");
        species.temperament.leash = 200;
        species.temperament.tuning["thinkDivisor"] = divisor;
        source.rows = parseRows(source.rows);
      } else {
        if (brain?.kind !== "skirmisher") throw new Error("Missing declared cadence");
        brain.thinkDivisor = divisor;
      }
      source.spawn.z = 87;
      const sim = createShardfileSim(source, new Map(), { rapier: await rapier });
      if (sim.host.bodyBands === undefined) sim.host.useBodyBands(bands);
      const originalThink = SkirmisherBrain.prototype.think,
        steps: number[] = [];
      const think = vi.spyOn(SkirmisherBrain.prototype, "think").mockImplementation(function (
        this: SkirmisherBrain<AnimalSim>,
        ports,
      ) {
        steps.push(ports.dt);
        originalThink.call(this, ports);
      });
      try {
        const period = Math.max(4, divisor);
        for (let tick = 1; tick <= 48; tick++) {
          sim.host.step();
          expect(steps.filter((dt) => dt > 0).length, `tick ${String(tick)}`).toBe(
            Math.floor(tick / period),
          );
        }
        for (const dt of steps) if (dt > 0) expect(dt).toBeCloseTo(period / 60);
        expect(sim.host.nearestPlayer({ x: 0, y: 0, z: 7 }).health.attributes.health).toBe(100);
      } finally {
        think.mockRestore();
        sim.dispose();
      }
    });
  }

test("a mutable ram consumes the same authored/band clock and restores its exact remainder", async () => {
  const source = groundFixture(),
    brain = nativeRows.find((row) => row.kind === "ram-grazer"),
    spawn = source.creatures.spawns[0],
    bite = source.rows.strikes[0];
  if (brain === undefined || spawn === undefined || bite === undefined)
    throw new Error("Missing real mutable cadence fixture");
  spawn.home = { x: 0, y: 0, z: 7, r: 45 };
  bite.shape = { kind: "lane", length: 4, width: 2 };
  source.creatures = parse(CreaturesSchema, { ...source.creatures, brains: [brain] });
  source.rows = parseRows(source.rows);
  source.spawn.z = 87;
  const sim = createShardfileSim(source, new Map(), { rapier: await rapier }),
    resumed = prepareShardfileSimRestore(source, new Map(), { rapier: await rapier });
  if (sim.host.bodyBands === undefined) sim.host.useBodyBands(bands);
  resumed.host.useBodyBands(bands);
  const think = vi.spyOn(RamGrazerBrain.prototype, "think");
  try {
    for (let tick = 1; tick <= 5; tick++) sim.host.step();
    expect(think).toHaveBeenCalledTimes(1);
    expect(think.mock.calls[0]?.[0].dt).toBeCloseTo(4 / 60);
    resumed.restore(snapshotSimHost(sim.host));
    think.mockClear();
    for (let tick = 6; tick <= 20; tick++) {
      sim.host.step();
      resumed.host.step();
      expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
    }
    expect(think).toHaveBeenCalledTimes(8);
  } finally {
    think.mockRestore();
    resumed.host.dispose();
    sim.dispose();
  }
});

test("near native decisions retain exact original actor, contact and RNG continuation", async () => {
  const source = groundFixture(),
    a = createShardfileSim(source, new Map(), { rapier: await rapier }),
    b = createShardfileSim(source, new Map(), { rapier: await rapier });
  b.host.useBodyBands(bands);
  try {
    for (let tick = 0; tick < 360; tick++) {
      a.host.step();
      b.host.step();
      expect(b.host.entities.get("fixture.actor")?.snapshot(), `body tick ${String(tick)}`).toEqual(
        a.host.entities.get("fixture.actor")?.snapshot(),
      );
      expect(b.host.rng.snapshot()).toEqual(a.host.rng.snapshot());
      expect(b.host.nearestPlayer({ x: 0, y: 0, z: 7 }).health.snapshot()).toEqual(
        a.host.nearestPlayer({ x: 0, y: 0, z: 7 }).health.snapshot(),
      );
    }
  } finally {
    b.dispose();
    a.dispose();
  }
});

test("the actual pursuit path decision uses the far clock while keeping its fixed cooldown owner", async () => {
  const source = groundFixture(),
    declaration = nativeRows.find((row) => row.kind === "pursue");
  if (declaration === undefined) throw new Error("Missing actual pursue declaration");
  source.spawn.z = 87;
  source.creatures = parse(CreaturesSchema, {
    ...source.creatures,
    brains: [{ ...declaration, speed: 0, awareRadius: 120, leashRadius: 200 }],
  });
  let paths = 0;
  const sim = createShardfileSim(source, new Map(), {
    rapier: await rapier,
    brains: {
      navigation: (_from, to) => {
        paths++;
        return [to];
      },
    },
  });
  if (sim.host.bodyBands === undefined) sim.host.useBodyBands(bands);
  try {
    for (let tick = 1; tick <= 24; tick++) {
      sim.host.step();
      expect(paths, `tick ${String(tick)}`).toBe(Math.floor(tick / 4));
    }
    const saved = sim.host.adapters.get("brain.fixture.actor")?.snapshot();
    expect(saved).toEqual(
      expect.objectContaining({ state: expect.objectContaining({ tick: 24, mode: "pursue" }) }),
    );
  } finally {
    sim.dispose();
  }
});
