// Exact old native-math saves live in an isolated process, never the portable native host realm.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseWeatherProgram } from "@wildshard/format/weatherProgram";
import { loadHeadlessFolder } from "../../src/server/host/headlessFolder.ts";
import { WeatherContinuation } from "../../src/shared/engine/world/weatherContinuation.ts";
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
// ZONE-SNAPSHOTS ZS10 (J507): the 2400-output oracle of pine-hollow-legacy's weather (a finished port) is gone;
// the old v1 saves still resume on the live Pine pin.
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
