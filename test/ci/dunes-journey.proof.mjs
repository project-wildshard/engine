/* oxlint-disable import/no-nodejs-modules -- CI-only native product assertions. */
// oxlint-disable-next-line import/no-unassigned-import -- Portable Math precedes the simulation graph.
import "../../src/shared/engine/core/portableMathFirst.ts";
import assert from "node:assert/strict";
import { leadPlayer } from "../../src/shared/engine/sim/leadPlayer.ts";
import { journey, timed } from "./product-journey.mjs";

timed(
  "pinned Dunes: spawn walk lights the signal, defeats the Matriarch and restores earned rewards",
  async () => {
    await journey("out/sunscar-dunes", async (f) => {
      const declared = f.product.shardfile.questHost;
      assert.ok(declared);
      const bossId = declared.graph.actions.find((row) => row.row === "fire")?.summon;
      assert.ok(bossId);
      const use = (id) => {
        const row = declared.interactions.rows.find((entry) => entry.id === id);
        assert.ok(row);
        if (row.crack === undefined) f.tick(0, 0, [{ kind: "interact", id }]);
        else
          f.native([
            { kind: "script", actorId: declared.graph.actor, value: row.act },
            { kind: "player", moveX: 0, moveZ: 0, yaw: 0 },
          ]);
        f.idle(2);
      };
      const strike = () => {
        const p = leadPlayer(f.host).position;
        const target = [...f.host.entities.values()].find(
          (body) => body.alive && Math.hypot(body.position.x - p.x, body.position.z - p.z) < 7,
        );
        return target === undefined ? null : { targetId: target.entityId };
      };
      const walk = (x, z, budget = 4000) => {
        for (let i = 0; i < budget; i++) {
          const p = leadPlayer(f.host).position,
            dx = x - p.x,
            dz = z - p.z;
          if (Math.hypot(dx, dz) < 0.5) return;
          f.tick(Math.atan2(-dx, -dz), 1, [], strike());
        }
        assert.fail(
          `Dunes walk blocked at ${JSON.stringify(leadPlayer(f.host).position)} heading to ${x},${z}`,
        );
      };
      f.idle(12);
      walk(6, 73);
      use("talk");
      assert.ok(f.host.flags.has("sunscar.scout"));
      walk(-76.97, 31.4);
      use("logbook");
      assert.ok(f.host.flags.has("sunscar.logbook"));
      walk(81.5, -6);
      use("crank");
      f.idle(60);
      use("well");
      assert.ok(f.host.flags.has("sunscar.oil"));
      for (const [i, x, z] of [
        [0, 58, -32.3],
        [1, -44, -20.3],
        [2, 34, -100.2],
      ]) {
        walk(x, z);
        use(`pour.${i}`);
        use(`light.${i}`);
        f.idle(60);
        assert.ok(f.host.flags.has(`sunscar.brazier.${i}`));
      }
      walk(8.75, -57);
      walk(8.75, -74.5);
      use("fire");
      assert.ok(f.host.flags.has("sunscar.lit"));
      walk(8.75, -58);
      walk(-6, -94);
      walk(-14, -138);
      let hurt = false;
      const boss = f.host.entities.get(bossId);
      assert.ok(boss);
      const health = boss.hp;
      for (let i = 0; i < 30000 && !f.host.flags.has("sunscar.complete"); i++) {
        const p = leadPlayer(f.host).position,
          t = f.host.state.tick / 60;
        const grounded = boss.alive && (boss.mem.phase ?? 0) >= 2;
        const x = grounded ? boss.position.x : -14 + Math.sin(t * 0.5) * 10,
          z = grounded ? boss.position.z : -138 + Math.cos(t * 0.5) * 10;
        const dx = x - p.x,
          dz = z - p.z,
          d = Math.hypot(dx, dz);
        f.tick(Math.atan2(-dx, -dz), d > (grounded ? 6 : 1) ? 1 : 0, [], strike());
        if (boss.hp < health) hurt = true;
      }
      console.info(
        JSON.stringify({
          slug: "sunscar-dunes",
          ticks: f.host.state.tick,
          boss: bossId,
          defeated: !boss.alive,
          rewards: 25,
        }),
      );
      assert.ok(hurt, "Actual weapon input must damage the living Matriarch");
      assert.ok(f.host.flags.has("sunscar.matriarch.down"));
      assert.ok(f.host.flags.has("sunscar.complete"));
      f.assertReward("sunscar.signal", 25);
      f.assertReward("sunscar.matriarch", 25);
      await f.replaySuffix();
      f.assertDuplicate("sunscar.signal", 25);
      f.assertDuplicate("sunscar.matriarch", 25);
      assert.ok(leadPlayer(f.host).health.alive);
    });
  },
);
