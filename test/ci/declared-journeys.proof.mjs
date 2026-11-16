/* oxlint-disable import/no-nodejs-modules -- CI-only node:test reads immutable product files and hashes public durable saves. */
// TC7: real input from the two declared products' spawns, outside hooks and Vitest discovery.
// oxlint-disable-next-line import/no-unassigned-import -- Install deterministic simulation Math before loading engine modules.
import "../../src/shared/engine/core/portableMathFirst.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadHeadlessProduct } from "../../src/server/host/headlessProduct.ts";
import { openCellWorld } from "../../src/server/host/standalone/cellWorld.ts";
import { loadRapier } from "../../src/shared/engine/physics/rapier.ts";
import { PlayerStore } from "../../src/server/host/dedicated/playerStore.ts";
import { ledgerFilings } from "../../src/server/host/standalone/ledgerFilings.ts";
import { leadPlayer } from "../../src/shared/engine/sim/leadPlayer.ts";
import {
  serializeSimSnapshot,
  snapshotSimHostBytes,
} from "../../src/shared/engine/sim/snapshot.ts";
import {
  outputDescriptor,
  serverReadsFile,
} from "../../src/shared/game/shardfile/outputDescriptor.ts";

const limit = 9500;
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function journey(directory, work) {
  const product = await loadHeadlessProduct(directory),
    shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  assert.ok(descriptor);
  const assets = new Map(
    descriptor.index.files
      .filter(
        (file) =>
          serverReadsFile(file, shard.terrain?.collider) &&
          (file.name === undefined || file.kind === "wasm" || file.kind === "tile"),
      )
      .map((file) => [
        file.commons === true ? `commons:${file.hash}` : file.hash,
        Uint8Array.from(readFileSync(join(directory, file.path))),
      ]),
  );
  const rapier = await loadRapier(
    Uint8Array.from(
      readFileSync(new URL(import.meta.resolve("@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm"))),
    ),
  );
  mkdirSync(resolve("tmp"), { recursive: true });
  const scratch = mkdtempSync(resolve("tmp/tc7-declared-"));
  const saveFile = join(scratch, "player.json");
  writeFileSync(saveFile, "{}");
  let player;
  const restorePlayer = () =>
    new PlayerStore(JSON.parse(readFileSync(saveFile, "utf8")), () => {
      writeFileSync(saveFile, JSON.stringify(player.documents()));
    });
  player = restorePlayer();
  const open = (saved) =>
    openCellWorld(
      { instance: `ring1-${shard.identity.slug}` },
      { product, shard, assets, rapier },
      saved,
      {
        saves: player.saves,
        owned: () => player.slots,
        lone: true,
        wholeSolids: true,
        pageless: true,
      },
    );
  const observed = [];
  const filings = [];
  let cell,
    seq = 0;
  const fileEffects = (effects) => {
    const rows = ledgerFilings(cell.host, "actor.player", effects, (name, entity, seat) =>
      cell.fact(name, entity, seat),
    );
    for (const filing of rows) cell.owned.of(filing.player).file(filing);
    filings.push(...rows);
    return rows;
  };
  const tick = (yaw = 0, forward = 0, acts = [], attack = null) => {
    const command = {
      seq: ++seq,
      viewTick: cell.host.state.tick,
      yaw,
      pitch: 0,
      buttons: 0,
      steer: { keyX: 0, keyY: 0, stickX: 0, stickY: forward },
      ...(attack === null ? {} : { attack }),
    };
    cell.step([{ client: 0, player: "actor.player", command, acts, extra: null, still: false }]);
    const lead = leadPlayer(cell.host);
    cell.fall.step(lead, () =>
      cell.host.combat.fall(lead.health, lead.position, { kind: "out-of-world", label: "" }),
    );
    observed.push(...structuredClone(cell.effects()));
    fileEffects(cell.effects());
  };
  const idle = (count) => {
    for (let i = 0; i < count; i++) tick();
  };
  const walk = (x, z, budget = 1200) => {
    for (let i = 0; i < budget; i++) {
      const p = leadPlayer(cell.host).position,
        dx = x - p.x,
        dz = z - p.z;
      if (Math.hypot(dx, dz) < 0.4) return true;
      tick(Math.atan2(-dx, -dz), 1);
    }
    return false;
  };
  const walkTo = (x, z) => assert.ok(walk(x, z), `Real walk could not reach (${x},${z})`);
  const snapshot = () => serializeSimSnapshot(snapshotSimHostBytes(cell.host));
  try {
    cell = await open();
    await work({
      get host() {
        return cell.host;
      },
      product,
      effects: observed,
      filings,
      assertReward(name, coins = 5) {
        assert.equal(
          filings.filter((row) => row.grant === "fact" && row.name === name && !row.pending).length,
          1,
        );
        assert.equal(cell.owned.of("actor.player").purse.coins, coins);
        assert.ok(Object.keys(JSON.parse(readFileSync(saveFile, "utf8"))).length > 0);
      },
      assertDuplicate(name, coins = 5) {
        const fact = observed.find((effect) => effect.kind === "fact" && effect.name === name);
        assert.ok(fact);
        const before = readFileSync(saveFile, "utf8");
        assert.deepEqual(
          fileEffects([fact]),
          [],
          "The real emitted fact must be refused as duplicate after restore",
        );
        assert.equal(readFileSync(saveFile, "utf8"), before);
        assert.equal(cell.owned.of("actor.player").purse.coins, coins);
      },
      native(commands) {
        assert.ok(cell.resident, "Native input requires the admitted resident");
        cell.resident.step(commands);
        const lead = leadPlayer(cell.host);
        cell.fall.step(lead, () =>
          cell.host.combat.fall(lead.health, lead.position, { kind: "out-of-world", label: "" }),
        );
        observed.push(...structuredClone(cell.effects()));
        fileEffects(cell.effects());
      },
      tick,
      idle,
      walk,
      walkTo,
      async replaySuffix() {
        const saved = snapshot(),
          documents = readFileSync(saveFile, "utf8"),
          savedSeq = seq,
          mark = observed.length;
        idle(60);
        const expected = digest(snapshot() + readFileSync(saveFile, "utf8")),
          expectedHealth = leadPlayer(cell.host).health.attributes.health;
        const expectedEffects = observed.slice(mark),
          replayMark = observed.length;
        cell.dispose();
        cell = undefined;
        writeFileSync(saveFile, documents);
        player = restorePlayer();
        cell = await open(saved);
        seq = savedSeq;
        idle(60);
        assert.equal(
          digest(snapshot() + readFileSync(saveFile, "utf8")),
          expected,
          "A fresh restored world must repeat the complete durable suffix",
        );
        assert.equal(leadPlayer(cell.host).health.attributes.health, expectedHealth);
        assert.deepEqual(
          observed.slice(replayMark),
          expectedEffects,
          "Restore must not lose or duplicate completed-tick effects",
        );
      },
    });
  } finally {
    cell?.dispose();
    rmSync(scratch, { recursive: true, force: true });
  }
}

function timed(name, work) {
  void test(name, { timeout: limit }, async () => {
    const started = performance.now();
    await work();
    assert.ok(performance.now() - started < limit, "Complete declared journey exceeds 9.5 seconds");
  });
}

timed(
  "pinned Template: walk the hut door, kill the blob, earn the quest and resume the save",
  async () => {
    await journey("out/_template", async (f) => {
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
      for (let i = 0; i < 240 && blob.alive; i++) {
        const p = leadPlayer(f.host).position,
          at = blob.position;
        const origin = { x: p.x, y: p.y + 1.68, z: p.z };
        const dx = at.x - origin.x,
          dy = at.y + blob.dims.bodyY * blob.scale - origin.y,
          dz = at.z - origin.z;
        const distance = Math.hypot(dx, dy, dz);
        f.tick(0, 0, [], {
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
