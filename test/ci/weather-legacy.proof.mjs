// Exact old native-math saves live in an isolated process, never the portable native host realm.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseWeatherProgram } from "@wildshard/format/weatherProgram";
import { loadHeadlessFolder } from "../../src/server/host/headlessFolder.ts";
import { WeatherContinuation } from "../../src/shared/engine/world/weatherContinuation.ts";
import { encodeCanonicalJson, hashImmutableBytes } from "../../src/shared/host/immutable.ts";
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const pine = async () => (await loadHeadlessFolder("out/pine-hollow")).json("world/weather.json");
function timed(name, work) {
  void test(name, { timeout: 9500 }, async () => {
    const start = performance.now();
    await work();
    assert.ok(
      performance.now() - start < 9500,
      "Complete legacy weather proof exceeds 9.5 seconds",
    );
  });
}
for (const seed of [1, 0x4a1a])
  for (const mode of ["live", "rain", "clear", "fog"]) {
    timed(
      `actual Pine weather retains all 2400 legacy outputs, seed ${seed} mode ${mode}`,
      async () => {
        const rows = parseWeatherProgram(await pine());
        const oracle = fixture("legacy-oracles/pine-weather.json").cases.find(
          (row) => row.seed === seed && row.mode === mode,
        );
        assert.ok(oracle);
        const current = new WeatherContinuation(rows, { seed, mode }),
          trace = [];
        const samples = new Map(oracle.samples.map((row) => [row.step, row.weather]));
        for (let i = 0; i < 2400; i++) {
          current.update(i % 11 === 0 ? 31 : ((i % 7) + 1) / 120, (i / 239) % 1);
          const value = current.captureWeather();
          trace.push(value);
          if (samples.has(i)) assert.deepEqual(value, samples.get(i));
          if (i === 987) current.force("rain");
          if (i === 1234) current.setMode("live");
        }
        assert.equal(
          hashImmutableBytes(new TextEncoder().encode(encodeCanonicalJson(trace))),
          oracle.sha256,
        );
      },
    );
  }

timed(
  "actual Pine resumes every old v1 cadence/wind save and rejects malformed saves atomically",
  async () => {
    const rows = parseWeatherProgram(await pine());
    for (const entry of fixture("weather-continuation.json")) {
      const current = new WeatherContinuation(rows, { seed: entry.seed, mode: entry.mode }),
        identity = current.gust?.current;
      current.prepareContinuationRestore(entry.saved)();
      assert.deepEqual(current.captureContinuation(), entry.saved);
      for (let i = 0; i < entry.tail.length; i++) {
        current.step(((i % 5) + 1) / 60, (i / 13) % 1);
        assert.deepEqual(current.captureContinuation(), entry.tail[i]);
      }
      for (const bad of [
        { ...entry.saved, boost: 2 },
        { ...entry.saved, wind: { ...entry.saved.wind, time: 0 } },
        { ...entry.saved, weather: { ...entry.saved.weather, n: { rain: 0 } } },
      ]) {
        const before = current.captureContinuation();
        assert.throws(() => current.prepareContinuationRestore(bad));
        assert.deepEqual(current.captureContinuation(), before);
        assert.equal(current.gust?.current, identity);
      }
    }
  },
);
