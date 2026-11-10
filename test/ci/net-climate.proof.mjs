// Real local rooms/packets and public page climate ports, never fabricated latest frames or a fake sky.
import "../../src/shared/engine/core/portableMathFirst.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseRows } from "@wildshard/format/rows";
import { parseWeatherProgram } from "@wildshard/format/weatherProgram";
import { WirePage } from "../../src/client/game/shardfile/wirePage.ts";
import { netClimate } from "../../src/client/game/weather/netClimate.ts";
import { NetClient } from "../../src/client/engine/net/client.ts";
import { NetRoom } from "../../src/server/engine/net/room.ts";
import { SimNetWorld } from "../../src/server/engine/net/simWorld.ts";
import { createSimHost } from "../../src/server/engine/sim.ts";
import { installDeclaredClimate } from "../../src/server/game/shardfile/declaredClimate.ts";
import { publishWeather } from "../../src/server/game/weather/wire.ts";
import { loadHeadlessProduct } from "../../src/server/host/headlessProduct.ts";
import { BitWriter } from "../../src/shared/engine/net/bits.ts";
import { decodeAct, encodeAct } from "../../src/shared/engine/net/messages.ts";
import { NET_SCHEMA_HASH } from "../../src/shared/engine/net/netSchemas.ts";
import { loadRapier } from "../../src/shared/engine/physics/rapier.ts";
import { actRoutes } from "../../src/shared/engine/sim/actRoutes.ts";
import { DAY_ROW, publishDay, shardRows } from "../../src/shared/engine/sim/shardRows.ts";
import {
  DEFAULT_NORMALIZED_DAY,
  normalizedDayClock,
} from "../../src/shared/engine/world/dayCycle.ts";
import { WeatherContinuation } from "../../src/shared/engine/world/weatherContinuation.ts";
import { netWorldInput } from "../../src/shared/host/standalone/netInput.ts";
import { directLoopback } from "../../src/test/engine/netLoopback.ts";
import { SIM_LEVEL } from "../fixtures/sim-level/level.ts";

const idle = {
  viewTick: 0,
  steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 },
  yaw: 0,
  pitch: 0,
  buttons: 0,
};
const declared = parseRows(
  JSON.parse(readFileSync(new URL("../fixtures/shardfile/rows.json", import.meta.url), "utf8")),
);
function timed(name, work) {
  void test(name, { timeout: 9500 }, async () => {
    const start = performance.now();
    await work();
    assert.ok(performance.now() - start < 9500, "Complete climate proof exceeds 9.5 seconds");
  });
}
async function room(work, options = {}) {
  const rapier = await loadRapier(
    readFileSync(new URL(import.meta.resolve("@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm"))),
  );
  const host = createSimHost(
    { ...SIM_LEVEL, entities: [], quests: [], ground: { size: 32, height: 0 } },
    { rapier },
  );
  try {
    const clock =
      options.clock === false
        ? null
        : host.useDayClock(normalizedDayClock(DEFAULT_NORMALIZED_DAY, null));
    const weatherCalls = { mode: [], force: [] };
    let air = null,
      program = null;
    if (options.weather !== false) {
      const product = await loadHeadlessProduct(
        "out/" + (options.pine ? "pine-hollow" : "nalati-grasslands"),
      );
      const data = await product.json("world/weather.json");
      program = parseWeatherProgram(options.pine ? data : data.weather);
      air = new WeatherContinuation(program, { seed: 19, mode: "live" });
      publishWeather(host, {
        get n() {
          return air.n;
        },
        get state() {
          return air.state;
        },
        get phaseLeft() {
          return air.phaseLeft;
        },
        get profile() {
          return air.profile;
        },
        get registers() {
          return air.registers;
        },
        setMode(name, at) {
          weatherCalls.mode.push([name, at]);
          air.setMode(name, at);
        },
        force(name, at) {
          weatherCalls.force.push([name, at]);
          air.force(name, at);
        },
      });
      host.onStep("proof.weather", (dt) => air.update(dt, clock?.phase ?? 0));
    }
    const world = new SimNetWorld(host, options.cell ?? 1),
      link = directLoopback(),
      client = new NetClient(link.client);
    try {
      const net = new NetRoom({
        world,
        step: (inputs) => {
          netWorldInput(actRoutes(host), inputs);
          host.step();
        },
      });
      const command = (word) => {
        const seq = client.command(idle);
        client.flush();
        if (word !== undefined) client.act({ kind: "climate", ...word, seq });
        link.pump();
        return seq;
      };
      const tick = (word) => {
        command(word);
        net.tick();
        link.pump();
        client.present();
      };
      const open = () => {
        net.join(link.server, world.player);
        client.hello("", { player: "climate-owner", name: "Climate owner" });
        link.pump();
        net.open();
        link.pump();
      };
      try {
        await work({
          host,
          clock,
          air,
          program,
          weatherCalls,
          client,
          net,
          link,
          command,
          tick,
          open,
        });
        assert.equal(client.dropped, 0);
        assert.equal(net.stats.dropped, 0);
      } finally {
        net.dispose();
      }
    } finally {
      client.dispose();
    }
  } finally {
    host.dispose();
  }
}

timed(
  "climate force and day acts preserve every word across the actual codec and schema hash",
  async () => {
    for (const act of [
      { kind: "climate", seq: 3, op: "force", name: "storm", at: 0.5 },
      { kind: "climate", seq: 4, op: "day", name: "room", at: 0.75 },
    ])
      assert.deepEqual(decodeAct(new Uint8Array(encodeAct(new BitWriter(), act))), act);
    assert.equal(typeof NET_SCHEMA_HASH, "number");
    assert.ok(Number.isFinite(NET_SCHEMA_HASH));
  },
);

timed("real wire day input is lone-only and cannot move a paused or shared clock", async () => {
  await room(async (f) => {
    f.open();
    f.tick({ op: "day", name: "room", at: 0.75 });
    assert.ok(Math.abs(f.clock.phase - 0.75) < 0.001);
    f.clock.phase = 0.25;
    f.clock.paused = true;
    f.tick({ op: "day", name: "room", at: 0.75 });
    assert.equal(f.clock.phase, 0.25);
    f.clock.paused = false;
    f.host.addPlayer("second", { x: 3, y: 0, z: 3 });
    f.tick({ op: "day", name: "room", at: 0.75 });
    assert.ok(Math.abs(f.clock.phase - 0.25) < 0.001);
  });
});

timed(
  "real weather owner hears known lone words and refuses unknown or shared-room words",
  async () => {
    await room(async (f) => {
      f.open();
      f.tick({ op: "mode", name: "live", at: -1 });
      assert.equal(f.air.mode, "live");
      f.tick({ op: "force", name: "storm", at: 0.25 });
      assert.equal(f.air.state, "storm");
      assert.ok(Math.abs(f.air.phaseT / f.air.phaseLen - 0.25) < 0.001);
      f.tick({ op: "mode", name: "nonsense", at: -1 });
      f.tick({ op: "force", name: "nonsense", at: 0 });
      assert.equal(f.air.mode, "live");
      assert.equal(f.air.state, "storm");
      f.host.addPlayer("second", { x: 1, y: 0, z: 1 });
      f.tick({ op: "mode", name: "clear", at: -1 });
      f.tick({ op: "force", name: "clear", at: 0.75 });
      assert.equal(f.air.mode, "live");
      assert.equal(f.air.state, "storm");
      assert.ok(f.air.phaseT / f.air.phaseLen < 0.3);
      assert.deepEqual(f.weatherCalls, { mode: [["live", undefined]], force: [["storm", 0.25]] });
    });
  },
);

timed(
  "a real weatherless room receives the word without creating weather or failing the session",
  async () => {
    await room(
      async (f) => {
        f.open();
        f.tick({ op: "force", name: "storm", at: 0.5 });
        assert.equal(shardRows(f.host).world.has("weather"), false);
        assert.ok(f.client.latest);
        assert.equal(f.net.stats.refused, 0);
      },
      { weather: false },
    );
  },
);

timed(
  "declared data climate advances 1200 real server ticks and reaches the actual wire",
  async () => {
    await room(
      async (f) => {
        installDeclaredClimate(f.host, { days: declared.days, weather: declared.weather });
        f.open();
        f.tick({ op: "day", name: "room", at: 0.75 });
        const row = () => shardRows(f.host).world.get("day")()[0];
        assert.equal(row().name, DAY_ROW);
        assert.ok(Math.abs(row().value - 0.75) < 1 / 4096);
        const before = row().value;
        for (let i = 0; i < 1200; i++) f.tick();
        assert.notEqual(row().value, before);
        assert.ok(shardRows(f.host).world.get("weather")().length > 0);
        assert.ok(f.client.latest);
        assert.equal(f.client.stateField(f.client.latest, DAY_ROW), row().value);
      },
      { clock: false, weather: false },
    );
  },
);

timed("day publication quantises an independent fractional phase before transport", async () => {
  await room(
    async (f) => {
      const authored = { phase: 0.123456789 };
      publishDay(f.host, authored);
      const value = shardRows(f.host).world.get("day")()[0].value;
      assert.equal(value, Math.round(authored.phase * 4096) / 4096);
      f.open();
      for (let i = 0; i < 8; i++) f.tick();
      assert.equal(f.client.stateField(f.client.latest, DAY_ROW), value);
    },
    { clock: false, weather: false },
  );
});

timed(
  "page preferences wait for real frames and persist mode across actual room rebind without replaying a jump",
  async () => {
    await room(
      async (first) => {
        await room(
          async (second) => {
            const page = new WirePage(),
              sent = [],
              feed = netClimate(page.climateRows, { weather: first.program }, (word) =>
                page.climate(word),
              );
            const bind = (f) =>
              page.bind(
                f.client,
                () => undefined,
                () => undefined,
                () => false,
                (word) => {
                  sent.push({ ...word, cell: f.client.latest?.cell });
                  f.command(word);
                },
              );
            try {
              bind(first);
              assert.equal(first.client.latest, null);
              feed.setMode("rain", 0.5);
              feed.force("clear", 0.1);
              assert.deepEqual(sent, []);
              first.open();
              for (let i = 0; i < 8; i++) {
                first.tick();
                page.frame(null, true);
              }
              assert.equal(sent.length, 2);
              assert.deepEqual(
                sent.map(({ op, name, at }) => ({ op, name, at })),
                [
                  { op: "mode", name: "rain", at: 0.5 },
                  { op: "force", name: "clear", at: 0.1 },
                ],
              );
              assert.equal(first.air.mode, "rain");
              assert.equal(first.air.state, "clear");
              bind(second);
              second.open();
              for (let i = 0; i < 8; i++) {
                second.tick();
                page.frame(null, true);
              }
              assert.equal(sent.length, 3);
              assert.deepEqual(sent[2], {
                kind: "climate",
                seq: 0,
                op: "mode",
                name: "rain",
                at: 0.5,
                cell: 0,
              });
              assert.equal(second.air.mode, "rain");
              assert.notEqual(second.air.state, "clear");
            } finally {
              page.unbind();
            }
          },
          { pine: true, cell: 0 },
        );
      },
      { pine: true, cell: 1 },
    );
  },
);

timed("page clock follows actual server rows and a paused page retains its own phase", async () => {
  await room(async (f) => {
    const page = new WirePage(),
      clock = { phase: 0.1, paused: false };
    page.bind(
      f.client,
      () => undefined,
      () => undefined,
      () => false,
    );
    try {
      f.open();
      f.clock.phase = 0.5;
      for (let i = 0; i < 8; i++) f.tick();
      page.frame(null, true, clock);
      assert.equal(clock.phase, f.client.stateField(f.client.latest, DAY_ROW));
      assert.ok(Math.abs(clock.phase - 0.5) < 0.001);
      const stopped = { phase: 0.2, paused: true };
      f.clock.phase = 0.7;
      for (let i = 0; i < 8; i++) f.tick();
      page.frame(null, true, stopped);
      assert.equal(stopped.phase, 0.2);
    } finally {
      page.unbind();
    }
  });
});
