/* oxlint-disable import/no-nodejs-modules -- CI-only assertions read the immutable format corpus. */
// oxlint-disable-next-line import/no-unassigned-import -- Portable Math precedes the simulation graph.
import "../../src/shared/engine/core/portableMathFirst.ts";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { leadPlayer } from "../../src/shared/engine/sim/leadPlayer.ts";
import { journey, timed } from "./folder-journey.mjs";

timed(
  "Template slice (TR-5): walk the hut door, kill the blob, earn the quest and resume the save",
  async () => {
    await journey("test/fixtures/gameplay-slice", async (f) => {
      f.idle(12);
      f.walkTo(-4, -9.5);
      f.tick(0, 0, [{ kind: "interact", id: "template.door.use" }]);
      f.idle(30);
      f.walkTo(-4, -12);
      f.walkTo(-4, -8.5);
      f.walkTo(0, -12);
      f.walkTo(2, -15);
      assert.ok(f.host.flags.has("template.hut"));
      const blob = f.host.entities.get("grey-blob:1");
      assert.ok(blob?.alive);
      const initialHealth = blob.hp;
      f.idle(20);
      assert.equal(blob.hp, initialHealth, "The blob must survive without weapon input");
      let hit = false;
      // Template rev 10's blob backs off between strikes, so the walker follows it into reach (AP36c)
      for (let i = 0; i < 600 && blob.alive; i++) {
        const p = leadPlayer(f.host).position,
          at = blob.position;
        const origin = { x: p.x, y: p.y + 1.68, z: p.z };
        const dx = at.x - origin.x,
          dy = at.y + blob.dims.bodyY * blob.scale - origin.y,
          dz = at.z - origin.z;
        const distance = Math.hypot(dx, dy, dz);
        const far = Math.hypot(dx, dz) > 3;
        f.tick(far ? Math.atan2(-dx, -dz) : 0, far ? 1 : 0, [], {
          aim: { origin, direction: { x: dx / distance, y: dy / distance, z: dz / distance } },
        });
        if (blob.alive && blob.hp < initialHealth) hit = true;
      }
      assert.ok(hit, "Real weapon input must lower live blob health before the kill");
      f.idle(4);
      assert.equal(blob.alive, false, "Only real weapon input may beat the blob");
      assert.ok(f.host.flags.has("template.blob"));
      assert.ok(f.host.flags.has("template.complete"));
      assert.equal(
        f.effects.filter((effect) => effect.kind === "fact" && effect.name === "template.quest")
          .length,
        1,
      );
      f.assertReward("template.quest");
      await f.replaySuffix();
      f.assertDuplicate("template.quest");
      assert.ok(f.host.flags.has("template.complete"));
      assert.equal(
        f.effects.filter((effect) => effect.kind === "fact" && effect.name === "template.quest")
          .length,
        1,
      );
    });
  },
);

timed(
  "frozen hall: a closed door blocks the walk, USE opens it, the guardian hits, and earned progress restores",
  async () => {
    const formatRoot = resolve(
      dirname(fileURLToPath(import.meta.resolve("@wildshard/format/outputIndex"))),
      "../..",
    );
    await journey(join(formatRoot, "corpus/handwritten"), async (f) => {
      f.idle(12);
      const untouched = leadPlayer(f.host).health.attributes.health;
      f.idle(100);
      assert.equal(
        leadPlayer(f.host).health.attributes.health,
        untouched,
        "The guardian cannot hurt the distant spawn",
      );
      f.tick(0, 0, [{ kind: "interact", id: "blender.door.use" }]);
      f.idle(12);
      assert.equal(
        f.host.flags.has("blender.door"),
        false,
        "An out-of-reach USE must not open the hall",
      );
      f.walkTo(0, 13.5);
      assert.equal(f.walk(0, 18, 90), false, "The actual closed door must block the body");
      assert.equal(f.host.flags.has("blender.door"), false);
      assert.ok(
        Math.abs(leadPlayer(f.host).position.z - 15.6) < 1,
        "The body must stop at the closed door plane",
      );
      f.tick(0, 0, [{ kind: "interact", id: "blender.door.use" }]);
      f.idle(30);
      assert.ok(f.host.flags.has("blender.door"));
      f.walkTo(0, 29);
      assert.ok(f.host.flags.has("blender.complete"));
      assert.equal(
        f.effects.filter((effect) => effect.kind === "fact" && effect.name === "blender.hall")
          .length,
        1,
      );
      const before = leadPlayer(f.host).health.attributes.health;
      f.idle(100);
      assert.ok(
        leadPlayer(f.host).health.attributes.health < before,
        "The actual guardian must land damage",
      );
      assert.ok(leadPlayer(f.host).health.attributes.health > 0);
      assert.equal(leadPlayer(f.host).health.alive, true);
      f.assertReward("blender.hall");
      await f.replaySuffix();
      f.assertDuplicate("blender.hall");
      assert.ok(f.host.flags.has("blender.complete"));
      assert.equal(
        f.effects.filter((effect) => effect.kind === "fact" && effect.name === "blender.hall")
          .length,
        1,
      );
    });
  },
);
