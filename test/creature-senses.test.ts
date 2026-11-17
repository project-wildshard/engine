import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Vector3 } from "three";
import { createShardfileSim } from "../src/server/game/plugin/simulation";
import { bindCreatureSenses } from "../src/server/game/shardfile/creatureSenses";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { addPiece } from "../src/shared/engine/physics/pieces";
import { groundFixture } from "./fixtures/plain-ground";

const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
async function fixture() {
  const source = groundFixture();
  const sim = createShardfileSim(source, new Map(), { rapier: await rapier }),
    actor = sim.host.entities.get("fixture.actor");
  if (actor === undefined) {
    sim.dispose();
    throw new Error("Missing actual sense body");
  }
  const player = sim.host.nearestPlayer(actor.position);
  const stand = (x: number, z: number) => {
    player.position.set(x, 0, z);
    player.motor.resetAt(player.position);
  };
  return { sim, actor, player, stand };
}

test("radius-only senses notice at their actual 3D radius, without changing a host owner", async () => {
  const f = await fixture();
  try {
    const rng = f.sim.host.rng.snapshot(),
      before = f.actor.snapshot(),
      adapters = [...f.sim.host.adapters.keys()];
    const senses = bindCreatureSenses(f.sim.host, f.actor, { notice: 6 });
    f.stand(0, 1);
    expect(senses.notices(f.player)).toBe(true);
    f.stand(0, 0.99);
    expect(senses.notices(f.player)).toBe(false);
    f.stand(0, 13);
    expect(senses.notices(f.player)).toBe(true);
    expect(f.sim.host.rng.snapshot()).toEqual(rng);
    expect(f.actor.snapshot()).toEqual(before);
    expect([...f.sim.host.adapters.keys()]).toEqual(adapters);
  } finally {
    f.sim.dispose();
  }
});

test("an authored sight cone replaces the radius visual test and follows actual heading", async () => {
  const f = await fixture();
  try {
    const senses = bindCreatureSenses(f.sim.host, f.actor, {
      notice: 12,
      sight: { range: 12, cone: Math.PI / 4 },
    });
    f.stand(0, 1);
    expect(senses.notices(f.player)).toBe(true);
    f.stand(0, 13);
    expect(senses.notices(f.player)).toBe(false);
    f.actor.place(0, 7, 0, 0);
    expect(senses.notices(f.player)).toBe(true);
    f.stand(8, 7);
    expect(senses.notices(f.player)).toBe(false);
  } finally {
    f.sim.dispose();
  }
});

test("actual raw sprint movement is heard behind the cone while a still player is missed", async () => {
  const f = await fixture();
  try {
    const senses = bindCreatureSenses(f.sim.host, f.actor, {
      notice: 0,
      sight: { range: 12, cone: 0.3 },
      hearing: { still: 0.5, crouch: 1, walk: 2, sprint: 15 },
    });
    f.stand(0, 13);
    expect(senses.notices(f.player)).toBe(false);
    for (let tick = 0; tick < 12; tick++)
      f.sim.host.step(
        new Map([
          [
            f.player.id,
            {
              moveX: 0,
              moveZ: 1,
              yaw: 0,
              commandVersion: 1,
              steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 },
              sprint: true,
            },
          ],
        ]),
      );
    expect(Math.hypot(f.player.velocity.x, f.player.velocity.z)).toBeGreaterThan(5.2);
    expect(Math.cos(f.actor.yaw)).toBeLessThan(0);
    expect(senses.notices(f.player)).toBe(true);
  } finally {
    f.sim.dispose();
  }
});

test("a sight ray uses the real world while hearing and reveal remain independent", async () => {
  const f = await fixture();
  try {
    f.stand(0, 1);
    f.sim.host.scope.run(() => {
      addPiece(f.sim.host.physics, {
        id: "actual.sight-wall",
        name: "Wall",
        category: "props",
        file: "test/creature-senses.test.ts",
        colliders: [{ kind: "box", x: 0, y: 1.5, z: 4, hx: 2, hy: 1.5, hz: 0.2 }],
      });
    });
    f.sim.host.physics.step();
    const sight = { range: 12, cone: Math.PI / 4 };
    expect(bindCreatureSenses(f.sim.host, f.actor, { notice: 12, sight }).notices(f.player)).toBe(
      false,
    );
    expect(
      bindCreatureSenses(f.sim.host, f.actor, {
        notice: 0,
        sight,
        hearing: { still: 7, crouch: 7, walk: 7, sprint: 7 },
      }).notices(f.player),
    ).toBe(true);
    f.stand(0, 8);
    expect(
      bindCreatureSenses(f.sim.host, f.actor, { notice: 0, sight, reveal: 1.1 }).notices(f.player),
    ).toBe(true);
  } finally {
    f.sim.dispose();
  }
});

test("senses pick an actual visible second player and exclude parked, dead and foreign seats", async () => {
  const f = await fixture(),
    other = await fixture();
  try {
    const senses = bindCreatureSenses(f.sim.host, f.actor, {
      notice: 12,
      sight: { range: 12, cone: 0.3 },
    });
    f.stand(0, 8);
    const second = f.sim.host.addPlayer("actual.second", { x: 0, y: 0, z: 1 });
    expect(senses.nearest()?.id).toBe(second.id);
    expect(senses.notices(other.player)).toBe(false);
    f.sim.host.parked.add(second.id);
    expect(senses.nearest()).toBeUndefined();
    f.sim.host.parked.delete(second.id);
    f.sim.host.combat.hit({
      source: "env",
      sourceTags: [],
      target: second.health,
      amount: 1000,
      point: second.position.clone(),
      dir: new Vector3(),
    });
    expect(second.health.alive).toBe(false);
    expect(senses.nearest()).toBeUndefined();
  } finally {
    other.sim.dispose();
    f.sim.dispose();
  }
});

test("omitted senses preserve the actual native nearest-player behavior and do no random work", async () => {
  const f = await fixture();
  try {
    f.sim.host.addPlayer("actual.second", { x: 0, y: 0, z: 13 });
    const rng = f.sim.host.rng.snapshot(),
      senses = bindCreatureSenses(f.sim.host, f.actor);
    expect(senses.nearest()).toBe(f.sim.host.nearestPlayer(f.actor.position));
    expect(senses.notices(f.player)).toBe(true);
    expect(f.sim.host.rng.snapshot()).toEqual(rng);
  } finally {
    f.sim.dispose();
  }
});

test("omitted senses retain the native dead-player observation fallback without granting acquisition", async () => {
  const f = await fixture();
  try {
    f.sim.host.combat.hit({
      source: "env",
      sourceTags: [],
      target: f.player.health,
      amount: 1000,
      point: f.player.position.clone(),
      dir: new Vector3(),
    });
    const senses = bindCreatureSenses(f.sim.host, f.actor);
    expect(senses.nearest()?.id).toBe(f.sim.host.nearestPlayer(f.actor.position).id);
    expect(senses.notices(f.player)).toBe(false);
  } finally {
    f.sim.dispose();
  }
});
