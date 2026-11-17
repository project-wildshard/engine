// oxlint-disable-next-line import/no-nodejs-modules -- Run the shipped physics binary through the default server.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import {
  createShardfileSim,
  prepareShardfileSimRestore,
} from "../src/server/game/plugin/simulation";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";

import { canonical, aliases, fixture, requireBrain } from "./fixtures/plain-brain-roster";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
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
