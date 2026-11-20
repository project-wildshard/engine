import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Vector3 } from "three";
import { createShardfileSim, prepareShardfileSimRestore } from "../src/server/game/plugin/simulation";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { canonicalSimDigest } from "../src/test/engine/simState";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { huntFixture } from "./fixtures/layer-hunt";

// ONE-FORMAT OF22b4 (Driftwood's declared boars): a declared hunt keeps the player it last observed. A dead or unsensing
// hunt observes no one, and its noise band keeps reading that cached place; a restore that rebuilt it from the player
// standing at construction diverged from the live host on the next ticks.
const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));

test("a restored dead declared hunt keeps the player it last observed and the canonical digest", async () => {
  const shard = huntFixture({ notice: 12, sight: { range: 12, cone: 0.6 } });
  shard.spawn.z = 30; // the first player stands far off; the hunt sees the second one
  const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier: await rapier });
  try {
    const actor = sim.host.entities.get("fixture.actor");
    if (actor === undefined) throw new Error("Missing declared hunt body");
    sim.host.addPlayer("actual.second", { x: actor.position.x + 4, y: 0, z: actor.position.z + 3 });
    for (let tick = 0; tick < 30; tick++) sim.host.step();
    const dealt = sim.host.combat.hit({ source: "env", sourceTags: ["dmg.legacy", "cover.checked"], target: actor.combatActor(),
      amount: actor.maxHp * 10, point: actor.position.clone(), dir: new Vector3(0, 0, 1) });
    expect(dealt?.killed).toBe(true);
    sim.host.step();
    resumed.restore(snapshotSimHost(sim.host));
    expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
    for (let tick = 0; tick < 120; tick++) {
      sim.host.step();
      resumed.host.step();
    }
    expect(canonicalSimDigest(snapshotSimHost(resumed.host))).toBe(canonicalSimDigest(snapshotSimHost(sim.host)));
  } finally {
    resumed.host.dispose();
    sim.dispose();
  }
});
