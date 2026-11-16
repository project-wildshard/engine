import '../../src/shared/engine/core/portableMathFirst.ts'
import assert from 'node:assert/strict'
// oxlint-disable-next-line import/no-nodejs-modules -- The native item oracle uses the actual shipped Rapier module.
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { parseItems } from '@wildshard/format/items'

import { createSimHost } from '../../src/server/engine/sim.ts'
import { restoreSimHost } from '../../src/server/engine/sim/restore.ts'
import {
  createNativeCombatFrame,
  installNativeItems,
} from '../../src/server/game/plugin/nativeItems.ts'
import { loadHeadlessFolder } from '../../src/server/host/headlessFolder.ts'
import { fillNativeCombatFrame } from '../../src/server/host/headlessRuntime.ts'
import { loadRapier } from '../../src/shared/engine/physics/rapier.ts'
import { snapshotSimHost } from '../../src/shared/engine/sim/snapshot.ts'
import { GustContinuation } from '../../src/shared/engine/world/weatherContinuation.ts'
import originalProfiles from '../fixtures/engine-lift/pine-item-profiles.json' with { type: 'json' }
import { SIM_LEVEL } from '../fixtures/sim-level/level.ts'
import {
  installPineCrossbow,
  boltFlight,
} from '../fixtures/weapon-oracle/headlessCrossbow.ts'
import { installPineLever } from '../fixtures/weapon-oracle/nativeLever.ts'
import { installPineLongbow } from '../fixtures/weapon-oracle/nativeLongbow.ts'
// GR8: called, not read from a scheduler job's output
const declaration = (items, id) => {
  const item = items.rows.find(row => row.id === id)
  if (
    item?.kind !== 'weapon' ||
    item.ranged === undefined ||
    item.profile === undefined
  )
    throw new Error('Missing fixture weapon')
  return { policy: item.ranged, profile: item.profile }
}
function fixtureLevel(z) {
  const level = structuredClone(SIM_LEVEL)
  for (const row of level.entities) {
    row.at.z = z
    row.spec.hp = 1e6
  }
  return level
}
timed(
  'combat lending retains attacks, first ranged hold, last melee release and last script without stale input',
  () => {
    const frame = createNativeCombatFrame(),
      attacks = frame.attacks,
      scripts = frame.scripts
    fillNativeCombatFrame(frame, [
      {
        kind: 'player',
        moveX: 1,
        moveZ: 0,
        yaw: 1,
        attack: { targetId: 'a' },
        heavy: { targetId: 'held' },
      },
      { kind: 'script', actorId: 'pick', value: 2 },
      { kind: 'player', moveX: 0, moveZ: 1, yaw: 2, attack: { targetId: 'b' } },
      { kind: 'script', actorId: 'pick', value: 0 },
    ])
    assert.deepEqual(frame.attacks, ['a', 'b'])
    assert.deepEqual(frame.heavy, { targetId: 'held' })
    assert.deepEqual(frame.melee, {
      attack: 'b',
      heavy: false,
      heavyTarget: null,
      swing: false,
      pitch: null,
      sprint: false,
      seq: 0,
      viewTick: 0,
    })
    assert.equal(frame.scripts.get('pick'), 0)
    assert.deepEqual([frame.moveX, frame.moveZ, frame.yaw], [0, 1, 2])
    fillNativeCombatFrame(frame, [])
    assert.equal(frame.attacks, attacks)
    assert.equal(frame.scripts, scripts)
    assert.deepEqual(frame.attacks, [])
    assert.equal(frame.heavy, null)
    assert.equal(frame.scripts.size, 0)
    assert.deepEqual(frame.melee, {
      attack: null,
      heavy: false,
      heavyTarget: null,
      swing: false,
      pitch: null,
      sprint: false,
      seq: 0,
      viewTick: 0,
    })
    assert.throws(() => {
      fillNativeCombatFrame(
        frame,
        Array.from({ length: 1025 }, () => ({
          kind: 'script',
          actorId: 'pick',
          value: 0,
        })),
      )
    })
  },
)
timed(
  'native item rows preserve all three old continuations, contacts, RNG, stowed flight and save resume',
  async () => {
    const rapier = await physics()
    const level = fixtureLevel(-8)
    let rain = 0
    const pine = await loadHeadlessFolder('out/pine-hollow'),
      items = parseItems(pine.shardfile.items),
      weatherProgram = await pine.json('world/weather.json')
    const frame = createNativeCombatFrame(),
      gust = new GustContinuation(weatherProgram.air)
    let old, current
    const install = host => {
      installNativeItems(host, frame, {
        kind: 'bolt',
        ...declaration(items, 'weapon.crossbow'),
      })
      installNativeItems(host, frame, {
        kind: 'cycle',
        ...declaration(items, 'weapon.lever'),
      })
      installNativeItems(host, frame, {
        kind: 'bow',
        ...declaration(items, 'weapon.longbow'),
      })
    }
    const installOld = host => {
      const bodies = () => [...host.entities.values()]
      installPineCrossbow(host, {
        shots: () => frame.attacks,
        enabled: () => frame.live.has(0),
        bodies,
        aim: () => frame.aim,
        adsBlend: () => frame.adsBlend,
        ammunition: () =>
          frame.ammo === 'pitch'
            ? 'pitch'
            : frame.ammo === 'broadhead'
              ? 'broadhead'
              : 'iron',
        flight: kind => boltFlight(kind, rain),
      })
      installPineLever(host, {
        shots: () => frame.attacks,
        enabled: () => frame.live.has(1),
        bodies,
        aim: () => frame.aim,
        adsBlend: () => frame.adsBlend,
        speedFactor: () => frame.speedFactor ?? 0,
      })
      installPineLongbow(host, {
        heavy: () => frame.heavy,
        enabled: () => frame.live.has(2),
        bodies,
        aim: () => frame.aim,
        wind: gust,
        aimed: () => frame.aimed,
        speedFactor: () => frame.speedFactor ?? 0,
        extraSpread: () => frame.extraSpread,
        mountSpread: () => frame.mountSpread,
      })
    }
    const ids = ['pine.crossbow', 'pine.lever', 'pine.longbow']
    const state = host => ids.map(id => host.adapters.get(id)?.snapshot())
    let contacts = 0,
      postRestoreContacts = 0
    try {
      for (const [name, expected] of Object.entries(originalProfiles))
        assert.deepEqual(declaration(items, `weapon.${name}`).profile, expected)
      old = createSimHost(level, { rapier })
      current = createSimHost(level, { rapier })
      installOld(old)
      install(current)
      current.events.on(
        'damage.dealt',
        () => {
          contacts++
        },
        current.scope,
      )
      for (let tick = 0; tick < 1500; tick++) {
        rain = (tick % 101) / 100
        gust.advance(1 / 60, 0.3)
        const wind = gust.snapshot()
        frame.rain = rain
        frame.wind = {
          clock: { time: wind.time, gust: wind.gust },
          field: {
            x: -0.55,
            z: 0.83,
            frontLength: 150,
            frontSpeed: 11,
            secondaryLength: 0.61 * 150,
          },
          base: 1.2,
          scale: 7,
        }
        frame.aim = tick % 11 === 0 ? 0.8 : 0.5
        frame.adsBlend = (tick % 61) / 60
        frame.aimed = (tick % 41) / 40
        frame.speedFactor = (tick % 37) / 36
        frame.extraSpread = 0.1
        frame.mountSpread = 0.2
        frame.ammo =
          tick % 3 === 0 ? 'pitch' : tick % 3 === 1 ? 'broadhead' : 'iron'
        frame.live.clear()
        frame.live.add(Math.floor(tick / 180) % 3)
        frame.armed.clear()
        frame.armed.add(Math.floor(tick / 180) % 3)
        frame.attacks.length = 0
        if (tick % 7 === 0) frame.attacks.push('absent', 'boar:1', 'boar:1')
        frame.heavy = tick % 110 < 70 ? { targetId: 'boar:1' } : null
        old.step()
        current.step()
        assert.deepEqual(
          state(current),
          state(old),
          `item state at tick ${String(tick)}`,
        )
        assert.deepEqual(current.rng.snapshot(), old.rng.snapshot())
        assert.equal(
          current.entities.get('boar:1')?.hp,
          old.entities.get('boar:1')?.hp,
        )
        if (tick === 649) {
          const oldSaved = snapshotSimHost(old),
            saved = snapshotSimHost(current)
          old.dispose()
          current.dispose()
          old = restoreSimHost(level, { rapier }, oldSaved, installOld)
          current = restoreSimHost(level, { rapier }, saved, install)
          current.events.on(
            'damage.dealt',
            () => {
              postRestoreContacts++
            },
            current.scope,
          )
          assert.deepEqual(state(current), state(old))
        }
      }
      assert.ok(contacts > 0)
      assert.ok(
        postRestoreContacts > 0,
        'Restored item owner must publish real contacts',
      )
      const adapter = current.adapters.get('pine.lever')
      if (adapter === undefined) throw new Error('Missing cycle continuation')
      const before = adapter.snapshot()
      if (
        typeof before !== 'object' ||
        before === null ||
        Array.isArray(before)
      )
        throw new Error('Missing saved cycle fields')
      assert.throws(() => {
        adapter.restore({ ...before, reserve: -1 })
      })
      assert.deepEqual(adapter.snapshot(), before)
    } finally {
      old?.dispose()
      current?.dispose()
    }
  },
)
timed(
  'the second native user keeps swept phases, synchronous reaction order and its saved wire',
  async () => {
    const driftwood = await loadHeadlessFolder('out/driftwood-isle'),
      policy = await driftwood.json('server/swords.json'),
      DRIFTWOOD_SWORDS = driftwood.shardfile.items
    const { installNativeSweptMelee } =
      await import('../../src/server/game/plugin/nativeSwept.ts')
    const rapier = await physics()
    const level = fixtureLevel(-1.6)
    const frame = createNativeCombatFrame(),
      expected = [],
      actual = []
    let old, current
    const record = (log, host, kind) => {
      log.push(
        `${String(host.state.tick)}:${kind}:${String(host.entities.get('boar:1')?.hp)}`,
      )
    }
    try {
      old = createSimHost(level, { rapier })
      current = createSimHost(level, { rapier })
      const original = installNativeSweptMelee(
        old,
        DRIFTWOOD_SWORDS.rows,
        policy,
        {
          input: () => frame.melee,
          alarm: () => {
            record(expected, old, 'alarm')
          },
          staggered: () => {
            record(expected, old, 'stagger')
          },
        },
      )
      current.events.answer(
        'item.reaction',
        reaction => {
          record(actual, current, reaction.kind)
          return reaction
        },
        current.scope,
      )
      const adopted = installNativeItems(current, frame, {
        kind: 'swept',
        policy,
        items: DRIFTWOOD_SWORDS.rows,
      })
      for (let tick = 0; tick < 420; tick++) {
        frame.melee.attack = tick % 31 === 0 ? 'boar:1' : null
        frame.melee.heavy = tick % 120 >= 30 && tick % 120 < 90
        frame.melee.heavyTarget = frame.melee.heavy ? 'boar:1' : null
        if (tick === 210) {
          original.equip(1)
          adopted.equip(1)
        }
        old.step()
        current.step()
        assert.equal(
          current.adapters.get(policy.step)?.snapshot(),
          old.adapters.get(policy.step)?.snapshot(),
        )
        assert.deepEqual(actual, expected)
        assert.equal(adopted.hits(), original.hits())
        assert.equal(
          current.entities.get('boar:1')?.hp,
          old.entities.get('boar:1')?.hp,
        )
        if (tick === 190) {
          const before = old.adapters.get(policy.step)?.snapshot()
          if (before === undefined) throw new Error('Missing saved swept state')
          current.adapters.get(policy.step)?.restore(before)
          assert.equal(current.adapters.get(policy.step)?.snapshot(), before)
        }
      }
      assert.ok(adopted.hits() > 0)
      assert.equal(
        actual.some(entry => entry.includes(':stagger:')),
        true,
      )
    } finally {
      old?.dispose()
      current?.dispose()
    }
  },
)
async function physics() {
  return loadRapier(
    readFileSync(
      new URL(
        import.meta.resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm'),
      ),
    ),
  )
}

function timed(name, work) {
  void test(name, { timeout: 9500 }, async () => {
    const start = performance.now()
    await work()
    assert.ok(
      performance.now() - start < 9500,
      'Complete native item case exceeds 9.5 seconds',
    )
  })
}
