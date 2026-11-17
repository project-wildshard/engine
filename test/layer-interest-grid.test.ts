import { readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { expect, test, vi } from "vitest";
import { GridAssembly } from "../src/shared/game/grid/assembly";
import { GridSimulation } from "../src/server/game/grid/simulation";
import { createSimHost } from "../src/server/engine/sim";
import { createShardfileSim } from "../src/server/game/plugin/simulation";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { groundFixture } from "./fixtures/plain-ground";

const systemLoad = loadavg()[0] ?? Infinity,
  reportPath = process.env["WS_LAYER_TIMING_REPORT"];
if (reportPath !== undefined)
  writeFileSync(reportPath, JSON.stringify({ systemLoad, measured: false }));
const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
async function world() {
  const source = groundFixture(true),
    seed = source.creatures.spawns[0];
  if (seed === undefined) throw new Error("Missing real grid creature");
  source.creatures.spawns = Array.from({ length: 40 }, (_, index) => ({
    ...seed,
    id: `fixture.actor.${String(index)}`,
    seed: index + 9,
    at: [((index % 8) - 3.5) * 4, 0, 25 + Math.floor(index / 8) * 4],
  }));
  const cell = createShardfileSim(source, new Map(), { rapier: await rapier });
  const road = createSimHost(
    {
      ...cell.host.level,
      id: "layer-timing-road",
      entities: [],
      ground: { size: 3000, height: 0 },
    },
    { rapier: await rapier },
  );
  const assembly = new GridAssembly({ developer: false, devserver: false }),
    home = assembly.cells[0];
  if (home === undefined) throw new Error("Missing actual grid cell");
  const grid = new GridSimulation(assembly, {
    highway: {
      host: road,
      dispose: () => {
        road.dispose();
      },
    },
    load: async () => ({
      host: cell.host,
      dispose: () => {
        cell.dispose();
      },
    }),
  });
  await grid.enter(home.instance);
  return { cell, grid, home };
}

test("the actual grid freezes forty native layer bodies when its last player leaves and resumes exact state", async () => {
  const { cell, grid, home } = await world();
  const original = cell.host.step.bind(cell.host),
    calls = vi.spyOn(cell.host, "step").mockImplementation((commands) => {
      original(commands);
    });
  try {
    expect(cell.host.entities.size).toBe(40);
    for (let tick = 0; tick < 120; tick++) grid.stepAll();
    expect(calls).toHaveBeenCalledTimes(120);
    (await grid.prepare(home.instance, null)).commit();
    // A frozen resident deliberately has no player motor: read its native creature owners directly.
    const frozen = () => ({
      state: structuredClone(cell.host.state),
      clock: cell.host.clock.snapshot(),
      rng: cell.host.rng.snapshot(),
      bodies: [...cell.host.entities].map(([id, body]) => [id, body.snapshot()]),
      controllers: [...cell.host.adapters].map(([id, adapter]) => [id, adapter.snapshot()]),
      strikes: [...cell.host.strikes].map(([id, strike]) => [id, strike.snapshot()]),
      physics: cell.host.physics.snapshot(),
    });
    const saved = frozen();
    calls.mockClear();
    for (let tick = 0; tick < 1200; tick++) grid.stepAll();
    expect(calls).not.toHaveBeenCalled();
    expect(frozen()).toEqual(saved);
    (await grid.prepare(null, home.instance)).commit();
    grid.stepAll();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(cell.host.state.tick).toBe(saved.state.tick + 1);
  } finally {
    calls.mockRestore();
    grid.dispose();
  }
});

// Timing is a separate proof; the functional real-grid case above runs at every load.
// The CPU-exclusive grant is acquired before collection, and local timing requires the lane's load<6 bound.
test.skipIf(systemLoad >= 6)(
  "forty native layer bodies with no player cost under five percent of their awake grid work",
  async () => {
    expect(systemLoad).toBeLessThan(6);
    const { cell, grid, home } = await world();
    const original = cell.host.step.bind(cell.host);
    let cellMs = 0,
      cellTicks = 0;
    const calls = vi.spyOn(cell.host, "step").mockImplementation((commands) => {
      const begin = performance.now();
      original(commands);
      cellMs += performance.now() - begin;
      cellTicks++;
    });
    try {
      for (let tick = 0; tick < 120; tick++) grid.stepAll();
      cellMs = 0;
      cellTicks = 0;
      const awakeStart = performance.now();
      for (let tick = 0; tick < 1200; tick++) grid.stepAll();
      const awakeGridMs = performance.now() - awakeStart,
        awakeMs = cellMs,
        awakeTicks = cellTicks;
      (await grid.prepare(home.instance, null)).commit();
      cellMs = 0;
      cellTicks = 0;
      const asleepStart = performance.now();
      for (let tick = 0; tick < 1200; tick++) grid.stepAll();
      const asleepGridMs = performance.now() - asleepStart,
        asleepMs = cellMs,
        asleepTicks = cellTicks;
      expect(awakeTicks).toBe(1200);
      expect(awakeMs).toBeGreaterThan(0);
      expect(asleepTicks).toBe(0);
      expect(asleepMs / awakeMs).toBeLessThan(0.05);
      const report = {
        proof: "OF26e3",
        measured: true,
        systemLoad,
        creatures: 40,
        awakeTicks,
        asleepTicks,
        awakeCellMs: awakeMs,
        asleepCellMs: asleepMs,
        awakeGridMs,
        asleepGridMs,
        cellCostFraction: asleepMs / awakeMs,
        qualification: "Real occupied/unoccupied grid cell; the highway still has its own cost.",
      };
      if (reportPath !== undefined) writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.info(JSON.stringify(report));
    } finally {
      calls.mockRestore();
      grid.dispose();
    }
  },
);
