// oxlint-disable-next-line import/no-nodejs-modules -- Run the shipped physics binary through the default server.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "valibot";
import { CreaturesSchema } from "@wildshard/format/creatures";
import { parseRows } from "@wildshard/format/rows";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import {
  createShardfileSim,
  prepareShardfileSimRestore,
} from "../src/server/game/plugin/simulation";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { groundFixture } from "./fixtures/plain-ground";
import { perchFixture } from "./fixtures/plain-perch";
import nativeRows from "./fixtures/plain-brain-roster.json";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
const canonical = [...nativeRows, perchFixture().creatures.brains[0]];
const aliases = [
  ["skirmisher", "stalker", "skirmish"],
  ["guardian", "guardian", "interior"],
  ["perch-hunter", "guardian", "perch"],
  ["ram-grazer", "grazer", "wander-ram"],
  ["challenge-grazer", "grazer", "circle-challenge"],
  ["orbit-diver", "diver", "orbit"],
  ["patrol-diver", "diver", "patrol"],
  ["burst-flyer", "diver", "burst"],
] as const;
function fixture(input: unknown) {
  const brain = parse(CreaturesSchema, { brains: [input], groups: [], spawns: [] }).brains[0];
  if (brain === undefined) throw new Error("Missing roster declaration");
  const kind = brain.kind,
    pattern = "pattern" in brain ? brain.pattern : undefined;
  const perch = kind === "perch-hunter" || (kind === "guardian" && pattern === "perch");
  const base = perch ? perchFixture() : groundFixture(),
    spawn = base.creatures.spawns[0],
    species = base.rows.species[0];
  if (spawn === undefined || species === undefined) throw new Error("Missing roster actor");
  if (kind === "ram-grazer" || (kind === "grazer" && pattern === "wander-ram"))
    spawn.home = { x: 0, y: 0, z: 7, r: 45 };
  if (kind === "challenge-grazer" || (kind === "grazer" && pattern === "circle-challenge"))
    spawn.phaseOffset = 0.3;
  if (
    kind === "diver" ||
    kind === "orbit-diver" ||
    kind === "patrol-diver" ||
    kind === "burst-flyer"
  ) {
    species.flight = { altitude: 4, above: "world", climbRate: 12, diveRate: 12 };
    spawn.at = [0, 4, 7];
  }
  const bite = base.rows.strikes[0];
  if (bite === undefined) throw new Error("Missing roster contact");
  base.rows.strikes.push({
    ...bite,
    id: "fixture.charge",
    shape: { kind: "lane", length: 4, width: 2 },
  });
  if (kind === "ram-grazer" || (kind === "grazer" && pattern === "wander-ram"))
    bite.shape = { kind: "lane", length: 4, width: 2 };
  if (kind === "challenge-grazer" || (kind === "grazer" && pattern === "circle-challenge"))
    bite.shape = { kind: "arc", radius: 2, halfAngle: Math.PI / 2 };
  return {
    ...base,
    spawn: { x: 0, y: 0, z: 8, yaw: Math.PI },
    rows: parseRows(base.rows),
    creatures: parse(CreaturesSchema, { ...base.creatures, brains: [brain], spawns: [spawn] }),
  };
}
function requireBrain(kind: string) {
  const row = canonical.find((value) => value?.kind === kind);
  if (row === undefined) throw new Error(`Missing canonical roster ${kind}`);
  return row;
}
function state(sim: Pick<ReturnType<typeof createShardfileSim>, "host">) {
  const actor = sim.host.entities.get("fixture.actor");
  if (actor === undefined) throw new Error("Missing actual roster actor");
  return {
    body: actor.snapshot(),
    controller: sim.host.adapters.get(`brain.${actor.entityId}`)?.snapshot(),
    rng: sim.host.rng.snapshot(),
    health: sim.host.nearestPlayer(actor.position).health.snapshot(),
    physics: snapshotSimHost(sim.host).physics,
  };
}

test.each(canonical)(
  "plain $kind runs one real body/controller/contact owner and restores",
  async (row) => {
    const source = fixture(row),
      bytes = JSON.stringify(source),
      sim = createShardfileSim(source, new Map(), { rapier: await rapier });
    const resumed = prepareShardfileSimRestore(source, new Map(), { rapier: await rapier });
    try {
      const actor = sim.host.entities.get("fixture.actor");
      if (actor === undefined) throw new Error("Missing actual roster actor");
      const player = sim.host.nearestPlayer(actor.position),
        hits: { move: string | undefined; amount: number; source: unknown }[] = [];
      sim.host.events.on(
        "damage.dealt",
        ({ req }) => {
          if (req.target === player.health)
            hits.push({ move: req.moveId, amount: req.amount, source: req.source });
        },
        sim.host.scope,
      );
      expect(sim.host.entities.size).toBe(1);
      expect([...sim.host.adapters.keys()].filter((id) => id.startsWith("brain."))).toEqual([
        "brain.fixture.actor",
      ]);
      const start = actor.snapshot();
      for (let tick = 0; tick < 1200 && hits.length === 0; tick++) sim.host.step();
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.source).toBe(actor.combatActor());
      expect(["fixture.bite", "fixture.charge", "fixture.throw"]).toContain(hits[0]?.move);
      expect(player.health.attributes.health).toBe(100 - (hits[0]?.amount ?? 0));
      expect(actor.snapshot()).not.toEqual(start);
      resumed.restore(snapshotSimHost(sim.host));
      expect(state(resumed)).toEqual(state(sim));
      for (let tick = 0; tick < 90; tick++) {
        sim.host.step();
        resumed.host.step();
      }
      expect(state(resumed)).toEqual(state(sim));
      expect(JSON.stringify(source)).toBe(bytes);
    } finally {
      resumed.host.dispose();
      sim.dispose();
    }
  },
);

test.each(aliases)(
  "%s alias %s/%s preserves native body, owner, contacts and RNG",
  async (kind, name, pattern) => {
    const original = requireBrain(kind),
      alias = { ...original, kind: name, pattern };
    const a = createShardfileSim(fixture(original), new Map(), { rapier: await rapier });
    const b = createShardfileSim(fixture(alias), new Map(), { rapier: await rapier });
    try {
      for (let tick = 0; tick < 360; tick++) {
        a.host.step();
        b.host.step();
        expect(state(b), `alias tick ${String(tick)}`).toEqual(state(a));
      }
    } finally {
      b.dispose();
      a.dispose();
    }
  },
);
