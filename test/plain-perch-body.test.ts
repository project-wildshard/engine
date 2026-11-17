import { readFileSync } from 'node:fs'

import { expect, test, vi } from 'vitest'

import { PerchHunterBrain } from '../src/server/engine/ai/perchHunter'
import { createShardfileSim } from '../src/server/game/plugin/simulation'
import { loadRapier } from '../src/shared/engine/physics/rapier'
import { shardRows } from '../src/shared/engine/sim/shardRows'
import { perchFixture } from './fixtures/plain-perch'

async function fixture(other = false) {
  const shard = perchFixture(),
    body = shard.creatures.perchBodies?.[0],
    spawn = shard.creatures.spawns[0]
  if (body === undefined || spawn === undefined)
    throw Error('Missing real plain fixture')
  if (other) {
    const second = structuredClone(body)
    second.id = 'fixture.second'
    second.sites = [{ at: [20, 9, 7], base: [20, 0, 7] }]
    shard.creatures.perchBodies?.push(second)
    shard.creatures.spawns.push({
      ...spawn,
      id: 'fixture.second',
      at: [20, 0, 7],
      perchBody: second.id,
      home: { x: 20, y: 0, z: 7, r: 45 },
    })
  }
  const rapier = await loadRapier(
    readFileSync('public/assets/physics/rapier.wasm'),
  )
  return createShardfileSim(shard, new Map(), { rapier })
}

test('default native loader resolves each same-species body authority and runs one controller on original cadence', async () => {
  const think = vi.spyOn(PerchHunterBrain.prototype, 'think')
  let sim: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    sim = await fixture(true)
    expect(think).not.toHaveBeenCalled()
    for (let n = 0; n < 6; n++) sim.host.step()
    expect(think).toHaveBeenCalledTimes(4)
    const one = sim.host.entities.get('fixture.actor'),
      two = sim.host.entities.get('fixture.second')
    expect(one?.mem['perch']).toBe(0)
    expect(two?.mem['perch']).toBe(0)
    expect([one?.mem['px'], one?.mem['pz'], one?.mem['perchH']]).toEqual([
      0, 7, 5.05,
    ])
    expect([two?.mem['px'], two?.mem['pz'], two?.mem['perchH']]).toEqual([
      20, 7, 9.05,
    ])
  } finally {
    think.mockRestore()
    sim?.dispose()
  }
})

test('the real default body throws a physical projectile toward its actual selected second player', async () => {
  const sim = await fixture()
  try {
    const first = sim.host.focusedPlayer
    first.position.set(-10, 0, -10)
    first.motor.resetAt(first.position)
    const peer = sim.host.addPlayer('fixture.peer', { x: 8, y: 0, z: 7 }),
      health = peer.health.attributes.health
    let visible = false
    const trace: unknown[] = []
    for (let n = 0; n < 25; n++) sim.host.step()
    expect(peer.health.attributes.health).toBe(health)
    // Preserve the original randomized initial cooldown; allow it to elapse.
    for (let n = 0; n < 395 && peer.health.attributes.health === health; n++) {
      sim.host.step()
      for (const read of shardRows(sim.host).bodies.values())
        if (read().enabled) visible = true
      if (n % 30 === 0) {
        const actor = sim.host.entities.get('fixture.actor')
        trace.push({
          n,
          state: actor?.mem['st'],
          cooldown: actor?.mem['cd'],
          phase: actor?.attackPhase,
        })
      }
    }
    expect(visible, JSON.stringify(trace)).toBe(true)
    expect(health - peer.health.attributes.health).toBe(5)
    sim.host.parked.add(peer.id)
    for (let n = 0; n < 60; n++) sim.host.step()
    expect(health - peer.health.attributes.health).toBe(5)
    expect(first.health.attributes.health).toBe(
      first.health.attributes.maxHealth,
    )
  } finally {
    sim.dispose()
  }
})

test('default perch drops, lands, bites once and returns up its declared trunk on native body clocks', async () => {
  const sim = await fixture()
  try {
    const actor = sim.host.entities.get('fixture.actor')
    if (actor === undefined) throw Error('Missing real actor')
    const player = sim.host.focusedPlayer,
      full = player.health.attributes.health,
      seen = new Set<number>()
    let bite = false
    player.position.set(0, 0, 7)
    player.motor.resetAt(player.position)
    for (let tick = 0; tick < 480; tick++) {
      sim.host.step()
      seen.add(actor.mem['st'] ?? -1)
      if (full - player.health.attributes.health >= 7) {
        bite = true
        sim.host.parked.add(player.id)
      }
    }
    expect(bite).toBe(true)
    expect(full - player.health.attributes.health).toBe(7)
    for (const phase of [0, 3, 4, 2, 5, 6])
      expect(seen.has(phase), `Missing real native phase ${phase}`).toBe(true)
    expect(actor.mem['climb']).toBe(0)
    expect(actor.yOffset).toBe(5.05)
    expect(actor.mem['st']).toBe(0)
  } finally {
    sim.dispose()
  }
})
