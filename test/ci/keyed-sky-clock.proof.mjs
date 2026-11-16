// CI-only owner contracts: actual admitted rows, public clock continuation and numeric weather responses.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseKeyedSky, SKY_PRESET } from '@wildshard/format/keyedSky'

import { overcastOver } from '../../src/client/game/looks/overcast.ts'
import { loadHeadlessFolder } from '../../src/server/host/headlessFolder.ts'
import { DayCycle } from '../../src/shared/engine/world/dayCycle.ts'
import { dayClock } from '../../src/shared/game/looks/dayClock.ts'
import { keyedSkyDay } from '../../src/shared/game/looks/keyedSkyClock.ts'

async function sky() {
  return (await loadHeadlessFolder('out/pine-hollow')).section(
    'look/keyed-sky',
  )
}
function independent(stock) {
  // Authored rows do not carry the old product's packed image catalogue into a different set of keys.
  const { packedKeys: _packed, ...base } = stock
  return {
    ...base,
    cycleMinutes: 7,
    start: 0.4,
    moonKey: 'lunar',
    keys: {
      blue: { id: 'invented-blue', sunU: 0.2, sunEl: 30, paint: 0 },
      lunar: { id: 'invented-moon', sunU: 0.8, sunEl: 50, paint: 0 },
    },
    presets: {
      bright: { ...base.presets.day, key: 'blue', lightI: 9, lamps: 0.25 },
      dark: { ...base.presets.night, key: 'lunar', lightI: 0.2 },
    },
    frames: [
      [0, 'bright'],
      [0.5, 'dark'],
      [1, 'bright'],
    ],
    response: {
      ...base.response,
      moonDisc: 0.4,
      overcastLamps: 0.8,
      domeDim: 0.7,
    },
    overcast: [
      { op: 'scale', key: 'lightI', by: -0.8 },
      { op: 'atLeast', key: 'lamps', by: 0.9 },
    ],
  }
}
function timed(name, work) {
  void test(name, { timeout: 9500 }, async () => {
    const started = performance.now()
    await work()
    assert.ok(
      performance.now() - started < 9500,
      'Complete keyed clock proof exceeds 9.5 seconds',
    )
  })
}

timed(
  'an independent author drives real clock and weather values without callbacks or shard branches',
  async () => {
    const rows = independent(await sky()),
      day = keyedSkyDay(rows),
      clock = new DayCycle(day.spec)
    clock.phase = 0
    const first = day.presets.bright
    assert.ok(first)
    const out = day.clone(first)
    clock.key(out)
    assert.equal(out.key, 'blue')
    assert.equal(out.lightI, 9)
    assert.equal(day.spec.curves.lamps(0), 0.25)
    overcastOver(out, day.style.overcast, 0.5)
    assert.ok(Math.abs(out.lightI - 5.4) < 1e-12)
    assert.equal(out.lamps, 0.45)
    assert.equal(first.lightI, 9)
    assert.equal(first.lamps, 0.25)
    clock.phase = 0.5
    clock.key(out)
    assert.equal(out.key, 'lunar')
    assert.equal(out.lightI, 0.2)
    assert.equal(day.style.response.overcastLamps, 0.8)
  },
)

timed(
  'the actual pinned day retains its exact checkpoint suffix and emitted light after a jump',
  async () => {
    const rows = await sky(),
      day = keyedSkyDay(rows),
      live = new DayCycle(day.spec),
      restored = new DayCycle(day.spec)
    live.cycle = rows.cycleMinutes * 60
    live.phase = 0.92
    for (let i = 0; i < 240; i++) live.update(0.5)
    const saved = JSON.parse(JSON.stringify(live.snapshot()))
    restored.restore(saved)
    const base = Object.values(day.presets)[0]
    assert.ok(base)
    const a = day.clone(base),
      b = day.clone(base)
    for (let i = 0; i < 240; i++) {
      live.update(0.5)
      restored.update(0.5)
      assert.deepEqual(restored.snapshot(), live.snapshot())
      live.key(a)
      restored.key(b)
      assert.deepEqual(b, a)
      assert.equal(restored.night, live.night)
      assert.equal(restored.lamps, live.lamps)
    }
    // A real public time command can pause and resume this authored clock; unknown names stay inert.
    const before = live.snapshot()
    live.pickTime('not-an-authored-time')
    assert.deepEqual(live.snapshot(), before)
    live.pickTime('night')
    restored.pickTime('night')
    assert.equal(live.phase, rows.fixed.night)
    live.update(60)
    restored.update(60)
    assert.deepEqual(restored.snapshot(), live.snapshot())
    assert.equal(live.phase, rows.fixed.night)
    assert.equal(restored.phase, rows.fixed.night)
    live.pickTime('live')
    restored.pickTime('live')
    live.update(0.5)
    restored.update(0.5)
    assert.deepEqual(restored.snapshot(), live.snapshot())
    assert.notEqual(live.phase, rows.fixed.night)
  },
)

timed(
  'clock admission refuses callbacks, accessors, bad frames and incomplete packed keys',
  async () => {
    const rows = independent(await sky()),
      admitted = parseKeyedSky(rows)
    assert.throws(() =>
      Reflect.apply(dayClock, undefined, [
        SKY_PRESET,
        { ...admitted, callback: () => 1 },
      ]),
    )
    assert.throws(() =>
      Reflect.apply(dayClock, undefined, [
        SKY_PRESET,
        admitted,
        { lamps: () => 1 },
      ]),
    )
    assert.throws(() =>
      Reflect.apply(dayClock, undefined, [
        SKY_PRESET,
        admitted,
        { lamps: 'key' },
      ]),
    )
    assert.throws(() => parseKeyedSky({ ...rows, onWeather: () => 1 }))
    let called = false
    const accessor = { ...rows }
    Object.defineProperty(accessor, 'cycleMinutes', {
      enumerable: true,
      get: () => {
        called = true
        return 7
      },
    })
    assert.throws(() => parseKeyedSky(accessor))
    assert.equal(called, false)
    for (const invalid of [
      {
        ...rows,
        frames: [
          [0, 'missing'],
          [1, 'bright'],
        ],
      },
      {
        ...rows,
        frames: [
          [0.5, 'bright'],
          [0, 'dark'],
        ],
      },
      { ...rows, packedKeys: {} },
      { ...rows, cycleMinutes: Infinity },
    ])
      assert.throws(() => parseKeyedSky(invalid))
  },
)
