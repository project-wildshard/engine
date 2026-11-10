// CI-only numerical/native contracts. No forced reaction registers, renderer or live server.
import "../../src/shared/engine/core/portableMathFirst.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseWeatherProgram } from "@wildshard/format/weatherProgram";

import { createSimHost } from "../../src/server/engine/sim.ts";
import { installWeatherContinuation } from "../../src/server/game/weather/continuation.ts";
import {
  installWeatherReactions,
  nativeWeatherBundle,
} from "../../src/server/game/weather/reactions.ts";
import { loadHeadlessProduct } from "../../src/server/host/headlessProduct.ts";
import { loadRapier } from "../../src/shared/engine/physics/rapier.ts";
import { WeatherContinuation } from "../../src/shared/engine/world/weatherContinuation.ts";
import { prepareReturns } from "../../src/server/game/shardfile/nativeRuntimeLoans.ts";
import { runtimeAssets } from "../fixtures/engine-lift/product.ts";
import { SIM_LEVEL } from "../fixtures/sim-level/level.ts";

const pine = async () => (await loadHeadlessProduct("out/pine-hollow")).json("world/weather.json");
function timed(name, work) {
  void test(name, { timeout: 9500 }, async () => {
    const start = performance.now();
    await work();
    assert.ok(performance.now() - start < 9500, "Complete weather proof exceeds 9.5 seconds");
  });
}
async function native(work) {
  const rapier = await loadRapier(
    readFileSync(new URL(import.meta.resolve("@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm"))),
  );
  const host = createSimHost(
    { ...SIM_LEVEL, entities: [], quests: [], ground: { size: 512, height: 0 } },
    { rapier },
  );
  try {
    host.physics.world.step();
    await work(host);
  } finally {
    host.dispose();
  }
}
async function storm(host, seed, points = [], circles = []) {
  const product = await loadHeadlessProduct("out/nalati-grasslands");
  const assets = runtimeAssets(product, "out/nalati-grasslands");
  (await prepareReturns({ product, assets }))(host);
  const bundle = nativeWeatherBundle(await product.json("world/weather.json"), circles);
  const current = installWeatherReactions(
    installWeatherContinuation({ seed }, bundle.weather, { phase: 0 }, undefined),
    { ...bundle.reactions, points },
    { host },
  );
  Object.assign(current.inputs, {
    px: 1,
    py: 0,
    pz: 2,
    calmSpeed: 5,
    calmDir: 0,
    calmGust: 0.6,
    crouched: 0,
    mounted: 0,
    held: 0,
  });
  current.weather.force("storm", 0.4);
  current.weather.hold = true;
  return current;
}

timed(
  "portable Pine accepts old saves and repeats its exact future wind and phase continuation",
  async () => {
    const rows = parseWeatherProgram(await pine());
    for (const entry of JSON.parse(
      readFileSync(new URL("../fixtures/weather-continuation.json", import.meta.url), "utf8"),
    )) {
      const current = new WeatherContinuation(rows, { seed: entry.seed, mode: entry.mode }),
        identity = current.gust.current;
      current.prepareContinuationRestore(entry.saved)();
      assert.deepEqual(current.captureContinuation(), entry.saved);
      const suffix = () =>
        Array.from({ length: entry.tail.length }, (_, i) => {
          current.step(((i % 5) + 1) / 60, (i / 13) % 1);
          const state = current.captureContinuation();
          // Existing portable-math policy deliberately differs from old native sin by an ulp.
          // The old native-math tail remains bit-exact in weather-legacy.proof.mjs.
          const historical = entry.tail[i];
          assert.deepEqual(state.weather, historical.weather);
          assert.equal(state.cadence, historical.cadence);
          assert.equal(state.boost, historical.boost);
          assert.equal(state.wind.time, historical.wind.time);
          return { state, wind: current.gust.vecAt(7, 11, { x: 0, y: 0, z: 0 }) };
        });
      const expected = suffix();
      current.prepareContinuationRestore(entry.saved)();
      assert.equal(current.gust.current, identity);
      assert.deepEqual(suffix(), expected);
      for (const bad of [
        { ...entry.saved, boost: 2 },
        { ...entry.saved, wind: { ...entry.saved.wind, time: 0 } },
        { ...entry.saved, weather: { ...entry.saved.weather, n: { rain: 0 } } },
      ]) {
        const before = current.captureContinuation();
        assert.throws(() => current.prepareContinuationRestore(bad));
        assert.deepEqual(current.captureContinuation(), before);
        assert.equal(current.gust.current, identity);
      }
    }
  },
);

timed(
  "shipped Nalati reactions share one weather clock at ten Hz and resume their observable suffix",
  async () => {
    await native(async (host) => {
      const current = await storm(host, 7, [], [[1, 2, 3]]);
      assert.equal(host.groundHeightAt(1, 2), 0);
      const owner = current.weather;
      let ticks = 0;
      for (let i = 0; i < 60; i++) if (current.update(1 / 60)) ticks++;
      assert.ok(ticks >= 9 && ticks <= 10);
      assert.equal(current.weather, owner);
      assert.equal(current.inputs.sheltered, 1);
      assert.equal(current.hud(5, false)?.getLow, false);
      const checkpoint = structuredClone(current.snapshot());
      const suffix = () =>
        Array.from({ length: 35 }, (_, i) => {
          current.update(((i % 3) + 1) / 60);
          return {
            weather: current.weather.captureWeather(),
            telegraph: { ...current.record("telegraph") },
            strike: { ...current.record("strike") },
          };
        });
      const expected = suffix();
      current.restore(checkpoint);
      assert.deepEqual(current.snapshot(), checkpoint);
      assert.deepEqual(suffix(), expected);
    });
  },
);

timed(
  "natural Nalati lightning chooses a high point and strikes it only after 1.2 seconds",
  async () => {
    await native(async (host) => {
      const points = Array.from({ length: 63 * 63 }, (_, i) => [
        (i % 63) * 8 - 248,
        Math.floor(i / 63) * 8 - 248,
        50,
      ]);
      const current = await storm(host, 19, points);
      Object.assign(current.inputs, { px: 0, pz: 0 });
      const telegraphs = [],
        strikes = [];
      let time = 0;
      const offTelegraph = current.on("telegraph", (event) => {
        telegraphs.push({ at: time, ...event });
      });
      const offStrike = current.on("strike", (event) => {
        strikes.push({ at: time, ...event });
      });
      // Public forced storm mode retains its naturally seeded next-bolt schedule.
      for (let i = 0; i < 1200 && telegraphs.length === 0; i++) {
        time += 0.1;
        current.update(0.1);
      }
      assert.equal(telegraphs.length, 1);
      assert.equal(strikes.length, 0);
      const first = telegraphs[0];
      assert.equal(first.kind, 1);
      assert.equal(first.y, 50);
      assert.ok(points.some(([x, z, top]) => x === first.x && z === first.z && top === first.y));
      for (let i = 0; i < 11; i++) {
        time += 0.1;
        current.update(0.1);
      }
      assert.equal(strikes.length, 0, "Lightning must retain the visible 1.2-second warning");
      for (let i = 0; i < 2 && strikes.length === 0; i++) {
        time += 0.1;
        current.update(0.1);
      }
      assert.equal(strikes.length, 1);
      assert.deepEqual(
        { x: strikes[0].x, z: strikes[0].z, kind: strikes[0].kind },
        { x: first.x, z: first.z, kind: 1 },
      );
      assert.ok(strikes[0].at - first.at >= 1.2 - 1e-8 && strikes[0].at - first.at <= 1.3 + 1e-8);
      // No re-arming register inspection: no extra strike can repeat without a new warning.
      for (let i = 0; i < 5; i++) {
        time += 0.1;
        current.update(0.1);
      }
      assert.equal(strikes.length, 1);
      offTelegraph();
      offStrike();
    });
  },
);

timed(
  "actual weather rows refuse incomplete phases, outputs and unbounded action inputs",
  async () => {
    const raw = await pine();
    for (const bad of [
      { ...raw, next: { clear: "missing" } },
      { ...raw, outputs: { rain: 1 } },
      { ...raw, values: [["rain", "later"]] },
      { ...raw, values: [["t", 1]] },
      { ...raw, values: [["bad", ["ss", 0, 1]]] },
    ])
      assert.throws(() => parseWeatherProgram(bad));
    for (const actions of [
      { tick: [{ target: "missing", value: 0 }] },
      { tick: [{ target: "boost", value: "register.missing" }] },
      { tick: [{ target: "boost", when: "clock", value: 0 }] },
      { tick: [{ target: "boost", value: { range: [0, "missing"] } }] },
      { tick: Array.from({ length: 65 }, () => ({ target: "boost", value: 0 })) },
    ])
      assert.throws(() => parseWeatherProgram({ ...raw, actions }));
    assert.throws(() =>
      parseWeatherProgram({ ...raw, outputs: { ...raw.outputs, wind: "register.boost" } }),
    );
  },
);

timed(
  "public page registrar keeps the authored system, single day clock and a frozen paused owner",
  async () => {
    const rows = parseWeatherProgram(await pine()),
      systems = [],
      state = { paused: false },
      day = { phase: 0.25 };
    // This is the public data-only registrar port, not a renderer/page boot claim.
    const current = installWeatherContinuation(
      {
        seed: 31,
        system: (spec) => {
          systems.push(spec);
        },
        state,
      },
      rows,
      day,
      "live",
    );
    assert.equal(systems.length, 1);
    const system = systems[0],
      { run, ...declaration } = system;
    assert.deepEqual(declaration, { ...rows.page, phase: "update" });
    const control = new WeatherContinuation(rows, { seed: 31, mode: "live" });
    for (let i = 0; i < 120; i++) {
      day.phase = i / 120;
      state.paused = i % 7 === 0;
      const before = current.captureContinuation();
      run(0.5, i * 0.5);
      if (state.paused) assert.deepEqual(current.captureContinuation(), before);
      else control.update(0.5, day.phase);
      assert.deepEqual(current.captureWeather(), control.captureWeather());
      assert.deepEqual(current.captureContinuation(), control.captureContinuation());
    }
  },
);
