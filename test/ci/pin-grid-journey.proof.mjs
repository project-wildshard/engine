/* oxlint-disable import/no-nodejs-modules -- CI-only native pin-grid journey and file-backed saves. */
// oxlint-disable-next-line import/no-unassigned-import -- Portable Math must precede simulation initialization.
import "../../src/shared/engine/core/portableMathFirst.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { StandaloneGrid } from "../../src/server/host/standalone/gridServer.ts";
import { loadHeadlessFolder } from "../../src/server/host/headlessFolder.ts";
import { ForwardedStorage } from "../../src/server/engine/saves/forwardedStorage.ts";
import { LedgerBook } from "../../src/server/engine/net/ledgerBook.ts";
import { NetClient } from "../../src/client/engine/net/client.ts";
import { saves } from "../../src/shared/engine/saves/runtime.ts";
import { installSaveEnvironment } from "../../src/shared/engine/saves/environment.ts";
import { loadRapier } from "../../src/shared/engine/physics/rapier.ts";
import { leadPlayer } from "../../src/shared/engine/sim/leadPlayer.ts";
import { installAppIdentity } from "../../src/shared/engine/app/identity.ts";
import { WILDSHARD_IDENTITY } from "../../src/client/game/identity.ts";
import { installCatalogue } from "../../src/shared/game/grid/catalogueSlot.ts";
import { readGridCollision } from "../../src/shared/game/grid/gridCollision.ts";
import { directLoopback } from "../../src/test/engine/netLoopback.ts";
import { runtimeAssets } from "../fixtures/engine-lift/folder.ts";

const limit = 9500;
void test(
  "Ring 1 pin grid: spawn walk crosses the real road, returns and reloads in Brasscap",
  { timeout: limit },
  async () => {
    const started = performance.now();
    installAppIdentity(WILDSHARD_IDENTITY);
    installCatalogue(JSON.parse(readFileSync("out/.ring-catalogue.json", "utf8")));
    const rapier = await loadRapier(
      readFileSync(new URL(import.meta.resolve("@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm"))),
    );
    mkdirSync("tmp", { recursive: true });
    const scratch = mkdtempSync(resolve("tmp/tc7-grid-")),
      file = join(scratch, "documents.json");
    writeFileSync(file, "{}");
    let server,
      client,
      link,
      clock = 0,
      steps = 0;
    let strips;
    const travels = [],
      loaded = [];
    const load = async (slug) => {
      loaded.push(slug);
      const directory = `out/${slug}`,
        product = await loadHeadlessFolder(directory);
      return {
        product,
        shard: product.shardfile,
        assets: runtimeAssets(product, directory),
        rapier,
      };
    };
    const boot = async () => {
      const storage = new ForwardedStorage(JSON.parse(readFileSync(file, "utf8")), (write) => {
        const documents = JSON.parse(readFileSync(file, "utf8"));
        if (write.value === null) delete documents[write.key];
        else documents[write.key] = write.value;
        writeFileSync(file, JSON.stringify(documents));
        storage.acked(write.seq, true);
      });
      installSaveEnvironment({
        storage: (scope) => (scope === "session" ? null : storage),
        persistent: () => true,
        persist: () => Promise.resolve(false),
      });
      const book = new LedgerBook();
      server = await StandaloneGrid.boot({
        slug: "brasscap-mesa",
        build: "tc7-pins",
        book,
        saves,
        storage,
        savePrefix: WILDSHARD_IDENTITY.savePrefix,
        load,
        strips: () => Promise.resolve(strips),
        stepped: () => undefined,
        now: () => clock,
      });
      if (server.restored?.ledger !== undefined) book.restore(server.restored.ledger);
      link = directLoopback();
      client = new NetClient(link.client, () => clock);
      client.onTravel((travel) => {
        travels.push(travel);
      });
      server.connect(link.server);
      client.hello("tc7-pins");
      link.pump();
      server.open();
      link.pump();
    };
    const retire = () => {
      client?.dispose();
      client = undefined;
      server?.dispose();
      server = undefined;
    };
    const step = async (yaw = 0, forward = 0) => {
      client.command({
        viewTick: client.latest?.tick ?? 0,
        steer: { keyX: 0, keyY: forward, stickX: 0, stickY: 0 },
        yaw,
        pitch: 0,
        buttons: forward !== 0 && steps++ % 45 === 0 ? 1 : 0,
      });
      client.flush();
      link.pump();
      server.tick();
      clock += 1000 / 60;
      link.pump();
      client.present();
      await setImmediate();
    };
    const until = async (done, yaw, forward, budget = 4000) => {
      for (let i = 0; i < budget; i++) {
        if (done()) return;
        await step(yaw, forward);
      }
      assert.fail(
        `Spawn walk did not arrive: ${JSON.stringify({ site: server.grid.current(), feet: leadPlayer(server.host).position, travels })}`,
      );
    };
    try {
      execFileSync(
        process.execPath,
        [
          "--import",
          "./scripts/bake-loader.mjs",
                    "scripts/bake-grid-seams.mjs",
          scratch,
          "--collision-only",
        ],
        {
          env: { ...process.env, WILDSHARD_CATALOGUE: "out/.ring-catalogue.json" },
          stdio: "pipe",
          timeout: 7000,
        },
      );
      strips = readGridCollision(
        JSON.parse(readFileSync(join(scratch, "out/.app/grid-collision/strips.json"), "utf8")),
        readFileSync(join(scratch, "out/.app/grid-collision/shapes.bin")),
      );
      await boot();
      const home = server.grid.current(),
        frame = server.assembly.cells.findIndex((cell) => cell.instance === home) + 1;
      assert.ok(home);
      assert.equal(server.assembly.cell(home).slug, "brasscap-mesa");
      assert.equal(server.restored, undefined);
      const spawn = leadPlayer(server.host).position.clone();
      await until(() => client.latest !== null, 0, 0, 30);
      assert.equal(client.latest.cell, frame);
      // Brasscap's spawn has an open line north to its north entryway (0, 250): walk straight out onto the road.
      await until(() => leadPlayer(server.host).position.z > 100, Math.PI, 1, 8000);
      await until(() => server.grid.current() === null, Math.PI, 1, 3000);
      await until(() => client.latest?.cell === 0, 0, 0, 30);
      assert.equal(travels.length, 1);
      assert.deepEqual([travels[0].from, travels[0].to], [frame, 0]);
      await until(
        () => server.grid.worldFeet().z > server.assembly.cell(home).origin.z + 270,
        Math.PI,
        1,
        500,
      );
      assert.ok(leadPlayer(server.host).health.alive);
      assert.ok(leadPlayer(server.host).position.y > -2);
      await until(() => server.grid.current() === home, 0, 1, 500);
      await until(() => leadPlayer(server.host).position.z < 240, 0, 1, 500);
      await until(() => client.latest?.cell === frame, 0, 0, 30);
      assert.equal(travels.length, 2);
      assert.deepEqual([travels[1].from, travels[1].to], [0, frame]);
      for (let i = 0; i < 12; i++) await step();
      assert.equal(
        server.host.respawn.falls("actor.player"),
        0,
        "The journey must not use a death to reset its feet",
      );
      const savedPosition = leadPlayer(server.host).position.clone(),
        saved = await server.save();
      assert.equal(saved.durable, true);
      assert.equal(client.dropped, 0);
      assert.ok(Object.keys(JSON.parse(readFileSync(file, "utf8"))).length > 0);
      retire();
      await boot();
      assert.equal(server.grid.current(), home);
      assert.equal(server.restored?.tick, saved.tick);
      assert.ok(
        leadPlayer(server.host).position.distanceTo(savedPosition) < 0.001,
        "Reload must resume the actually walked cell position",
      );
      await until(() => client.latest !== null, 0, 0, 30);
      assert.equal(client.latest.cell, frame);
      assert.equal(client.dropped, 0);
      assert.ok(leadPlayer(server.host).health.alive);
      console.info(
        JSON.stringify({
          home,
          spawn: spawn.toArray(),
          saved: savedPosition.toArray(),
          travels,
          loaded,
          ms: Math.round(performance.now() - started),
        }),
      );
    } finally {
      retire();
      installSaveEnvironment({
        storage: () => null,
        persistent: () => false,
        persist: () => Promise.resolve(false),
      });
      rmSync(scratch, { recursive: true, force: true });
    }
    assert.ok(performance.now() - started < limit, "Complete pin-grid journey exceeds 9.5 seconds");
  },
);
