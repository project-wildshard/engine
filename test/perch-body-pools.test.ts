import { readFileSync } from 'node:fs'

import { Vector3 } from 'three'
import { expect, test, vi } from 'vitest'

import { buildPlatformSpawns } from '../src/server/engine/ai/platform'
import { createSimHost } from '../src/server/engine/sim'
import { restoreSimHost } from '../src/server/engine/sim/restore'
import { speciesResolver, simStrikes } from '../src/server/game/plugin/brain'
import {
  installPerchBodyPools,
  PERCH_POOLS_STEP,
} from '../src/server/game/shardfile/perchBodyPools'
import { Rng } from '@wildshard/format/seededRng'
import { Bodies } from '../src/shared/engine/physics/bodies'
import { loadRapier } from '../src/shared/engine/physics/rapier'
import { shardRows } from '../src/shared/engine/sim/shardRows'
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot'
import { perchFixture } from './fixtures/plain-perch'
import { SIM_LEVEL } from './fixtures/sim-level/level'

async function fixture() {
  const rapier = await loadRapier(
      readFileSync('public/assets/physics/rapier.wasm'),
    ),
    shard = perchFixture()
  const first = shard.creatures.perchBodies?.[0]
  if (first === undefined) throw Error('Missing actual catalogue fixture')
  first.projectile.pool.count = 2
  const second = structuredClone(first)
  second.id = 'fixture.other'
  second.projectile.pool.count = 1
  const catalogue = [first, second]
  const level = {
    ...SIM_LEVEL,
    entities: buildPlatformSpawns(
      shard.creatures.spawns,
      speciesResolver(shard.rows, shard.creatures.brains),
      simStrikes(shard.rows),
    ),
    quests: [],
  }
  const host = createSimHost(level, { rapier }),
    pools = installPerchBodyPools(host, catalogue, shard.rows)
  const actor = host.entities.get('fixture.actor')
  if (actor === undefined) throw Error('Missing native actor')
  const rng = new Rng(17)
  return { rapier, shard, catalogue, level, host, pools, actor, rng }
}

test('catalogue shots fly through real Rapier before declared damage reaches the actual second player once', async () => {
  const f = await fixture()
  try {
    const first = f.host.focusedPlayer
    first.position.set(-10, 0, -10)
    const peer = f.host.addPlayer('fixture.peer', { x: 8, y: 0, z: 7 })
    const seen: unknown[] = []
    f.host.events.on(
      'damage.dealt',
      ({ req }) => {
        if (req.target === peer.health)
          seen.push({
            source: req.source,
            tags: req.sourceTags,
            move: req.moveId,
          })
      },
      f.host.scope,
    )
    const health = peer.health.attributes.health,
      at = new Vector3(0, 1, 7),
      to = peer.position.clone().add(new Vector3(0, 1, 0))
    f.pools.throw('fixture.perch', at, to, f.actor, f.rng)
    expect(peer.health.attributes.health).toBe(health)
    for (let tick = 0; tick < 100; tick++) f.host.step()
    expect(health - peer.health.attributes.health).toBe(5)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      source: f.actor.combatActor(),
      tags: ['creature.fixture', ...f.actor.combatActor().tags],
      move: 'fixture.throw',
    })
    expect(first.health.attributes.health).toBe(
      first.health.attributes.maxHealth,
    )
  } finally {
    f.host.dispose()
  }
})

test('one catalogue shares its bounded round-robin slots; another owns its own actual body and published pose', async () => {
  const f = await fixture()
  try {
    for (let n = 0; n < 3; n++)
      f.pools.throw(
        'fixture.perch',
        new Vector3(n, 4, 7),
        new Vector3(10, 4, 7),
        f.actor,
        f.rng,
      )
    f.pools.throw(
      'fixture.other',
      new Vector3(-4, 4, 7),
      new Vector3(-10, 4, 7),
      f.actor,
      f.rng,
    )
    f.host.step()
    const saved = f.host.adapters.get(PERCH_POOLS_STEP)?.snapshot()
    expect(saved).toMatchObject({
      version: 1,
      pools: [
        { id: 'fixture.perch', next: 1, slots: [{ k: 0 }, { k: 1 }] },
        { id: 'fixture.other', next: 0, slots: [{ k: 0 }] },
      ],
    })
    const rows = shardRows(f.host).bodies
    expect([...rows.keys()]).toEqual([
      'script:volley.perch.0.0',
      'script:volley.perch.0.1',
      'script:volley.perch.1.0',
    ])
    for (const read of rows.values()) {
      const row = read()
      expect(row.enabled).toBe(true)
      expect(row.position.y).toBeGreaterThan(3)
    }
  } finally {
    f.host.dispose()
  }
})

test('a cell over the 32-player cap steps its perch pools instead of crashing the world (QA 11-24 row 24)', async () => {
  const f = await fixture()
  try {
    for (let n = 0; n < 40; n++) f.host.addPlayer(`fixture.crowd.${String(n)}`, { x: 8 + n * 0.1, y: 0, z: 7 })
    expect(f.host.players.size).toBeGreaterThan(32)
    f.pools.throw('fixture.perch', new Vector3(0, 4, 7), new Vector3(10, 4, 7), f.actor, f.rng)
    expect(() => { for (let tick = 0; tick < 30; tick++) f.host.step() }).not.toThrow()
  } finally {
    f.host.dispose()
  }
})

test('native restore reattaches the original handles without spawn, entropy or publication and replays exactly', async () => {
  const f = await fixture()
  let again: ReturnType<typeof createSimHost> | undefined
  try {
    f.pools.throw(
      'fixture.perch',
      new Vector3(0, 4, 7),
      new Vector3(8, 3, 7),
      f.actor,
      f.rng,
    )
    for (let tick = 0; tick < 12; tick++) f.host.step()
    const saved = snapshotSimHost(f.host),
      spawn = vi.spyOn(Bodies.prototype, 'spawn'),
      random = vi.spyOn(Rng.prototype, 'next')
    try {
      again = restoreSimHost(f.level, { rapier: f.rapier }, saved, host => {
        installPerchBodyPools(host, f.catalogue, f.shard.rows)
      })
      expect(spawn).not.toHaveBeenCalled()
      expect(random).not.toHaveBeenCalled()
    } finally {
      spawn.mockRestore()
      random.mockRestore()
    }
    expect(snapshotSimHost(again)).toEqual(saved)
    for (let tick = 0; tick < 50; tick++) {
      f.host.step()
      again.step()
    }
    expect(snapshotSimHost(again)).toEqual(snapshotSimHost(f.host))
  } finally {
    again?.dispose()
    f.host.dispose()
  }
})

test('empty catalogue installs no host owner; invalid launch authority refuses before native mutation', async () => {
  const f = await fixture()
  try {
    const fresh = createSimHost(f.level, { rapier: f.rapier })
    try {
      const before = snapshotSimHost(fresh)
      installPerchBodyPools(fresh, [], f.shard.rows)
      expect(snapshotSimHost(fresh)).toEqual(before)
    } finally {
      fresh.dispose()
    }
    const before = snapshotSimHost(f.host),
      stream = f.rng.snapshot()
    expect(() =>
      f.pools.throw('missing', new Vector3(), new Vector3(), f.actor, f.rng),
    ).toThrow(/perch/i)
    expect(snapshotSimHost(f.host)).toEqual(before)
    expect(f.rng.snapshot()).toEqual(stream)
  } finally {
    f.host.dispose()
  }
})

test('admitted native slots survive page-tier pressure and keep exact continuation above forty bodies', async () => {
  const f = await fixture()
  let first: ReturnType<typeof createSimHost> | undefined,
    again: ReturnType<typeof createSimHost> | undefined
  try {
    const row = structuredClone(f.catalogue[0])
    if (row === undefined) throw Error('Missing actual catalogue')
    row.projectile.pool.count = 48
    first = createSimHost(f.level, { rapier: f.rapier })
    const pools = installPerchBodyPools(first, [row], f.shard.rows)
    const source = first.entities.get('fixture.actor')
    if (source === undefined) throw Error('Missing real actor')
    for (let n = 0; n < 48; n++)
      pools.throw(
        row.id,
        new Vector3(n / 20, 4, 7),
        new Vector3(10, 4, 7),
        source,
        f.rng,
      )
    first.step()
    const saved = snapshotSimHost(first)
    const state = first.adapters.get(PERCH_POOLS_STEP)?.snapshot()
    if (
      state === null ||
      Array.isArray(state) ||
      typeof state !== 'object' ||
      !Array.isArray(state['pools'])
    )
      throw Error('Missing real pool continuation')
    expect(state['pools'][0]).toMatchObject({
      slots: expect.arrayContaining([expect.objectContaining({ k: 47 })]),
    })
    expect(
      [...shardRows(first).bodies.values()].filter(read => read().enabled),
    ).toHaveLength(48)
    again = restoreSimHost(f.level, { rapier: f.rapier }, saved, host => {
      installPerchBodyPools(host, [row], f.shard.rows)
    })
    for (let n = 0; n < 20; n++) {
      first.step()
      again.step()
    }
    expect(snapshotSimHost(again)).toEqual(snapshotSimHost(first))
  } finally {
    again?.dispose()
    first?.dispose()
    f.host.dispose()
  }
})
