/* oxlint-disable import/no-nodejs-modules -- CI-only node:test reads immutable product files and hashes public durable saves. */
// TC7's product/input/durable-save boundary, outside hooks and Vitest discovery.
// oxlint-disable-next-line import/no-unassigned-import -- Install deterministic simulation Math before loading engine modules.
import "../../src/shared/engine/core/portableMathFirst.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadHeadlessFolder } from "../../src/server/host/headlessFolder.ts";
import { openCellWorld } from "../../src/server/host/standalone/cellWorld.ts";
import { loadRapier } from "../../src/shared/engine/physics/rapier.ts";
import { PlayerStore } from "../../src/server/host/dedicated/playerStore.ts";
import { ledgerFilings } from "../../src/server/host/standalone/ledgerFilings.ts";
import { leadPlayer } from "../../src/shared/engine/sim/leadPlayer.ts";
import {
  serializeSimSnapshot,
  snapshotSimHostBytes,
} from "../../src/shared/engine/sim/snapshot.ts";
import { outputDescriptor } from "../../src/shared/game/shardfile/outputDescriptor.ts";
import { serverInputFiles } from "../../src/shared/game/shardfile/serverSkinRigs.ts";

const limit = 9500;
const digest = (value) => createHash("sha256").update(value).digest("hex");

export async function journey(directory, work) {
  const product = await loadHeadlessFolder(directory),
    shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  assert.ok(descriptor);
  const assets = new Map(
    serverInputFiles(descriptor.index.files, shard)
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

export function timed(name, work) {
  void test(name, { timeout: limit }, async () => {
    const started = performance.now();
    await work();
    assert.ok(performance.now() - started < limit, "Complete declared journey exceeds 9.5 seconds");
  });
}
