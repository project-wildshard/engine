// Explicit CI owner cases: native input/floors and public borrowed author ports, never forced quest flags.
import '../../src/shared/engine/core/portableMathFirst.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { NetClient } from '../../src/client/engine/net/client.ts'
import { NetRoom } from '../../src/server/engine/net/room.ts'
import { SimNetWorld } from '../../src/server/engine/net/simWorld.ts'
import { createSimHost } from '../../src/server/engine/sim.ts'
import { PlayerStore } from '../../src/server/host/dedicated/playerStore.ts'
import { loadHeadlessProduct } from '../../src/server/host/headlessProduct.ts'
import { openCellWorld } from '../../src/server/host/standalone/cellWorld.ts'
import { ledgerFilings } from '../../src/server/host/standalone/ledgerFilings.ts'
import { withOwner } from '../../src/shared/engine/app/ownership.ts'
import { addPiece } from '../../src/shared/engine/physics/pieces.ts'
import { floorBelow } from '../../src/shared/engine/physics/query.ts'
import { loadRapier } from '../../src/shared/engine/physics/rapier.ts'
import { SaveStore } from '../../src/shared/engine/saves/store.ts'
import { leadPlayer } from '../../src/shared/engine/sim/leadPlayer.ts'
import { bindInteractionState } from '../../src/shared/engine/world/interact/flags.ts'
import {
  autoFlag,
  bindInteractPlacements,
  createQuestPlacements,
  readInteractPlacements,
} from '../../src/shared/engine/world/interact/types.ts'
import { directLoopback } from '../../src/test/engine/netLoopback.ts'
import { runtimeAssets } from '../fixtures/engine-lift/product.ts'
import { SIM_LEVEL } from '../fixtures/sim-level/level.ts'

const limit = 9500
const physics = () =>
  loadRapier(
    readFileSync(
      new URL(
        import.meta.resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm'),
      ),
    ),
  )
const idle = {
  viewTick: 0,
  steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 },
  yaw: 0,
  pitch: 0,
  buttons: 0,
}
function timed(name, work) {
  void test(name, { timeout: limit }, async () => {
    const started = performance.now()
    await work()
    assert.ok(
      performance.now() - started < limit,
      'Complete placement proof exceeds 9.5 seconds',
    )
  })
}

async function island(work) {
  const directory = 'out/driftwood-isle',
    product = await loadHeadlessProduct(directory),
    rapier = await physics()
  const stores = new Map(),
    rewards = new PlayerStore({}, () => undefined).rewards
  const owned = id => {
    let value = stores.get(id)
    if (value === undefined) {
      value = new PlayerStore({}, () => undefined).slots
      stores.set(id, value)
    }
    return value
  }
  // Real server stores acknowledge in-process forwarding; this is not database durability.
  const profiles = {
    read: id => rewards.read('driftwood-isle').players[id] ?? null,
    write: (id, state) => {
      const value = rewards.read('driftwood-isle')
      value.players[id] = state
      return rewards.write(value, 'driftwood-isle')
    },
  }
  const cell = await openCellWorld(
    { instance: 'sdk-placement' },
    {
      product,
      shard: product.shardfile,
      assets: runtimeAssets(product, directory),
      rapier,
    },
    undefined,
    {
      saves: new SaveStore({ local: null, session: null }),
      lone: true,
      wholeSolids: true,
      pageless: true,
      owned,
      profiles,
    },
  )
  const host = cell.host,
    lead = leadPlayer(host),
    world = new SimNetWorld(host, 0, () => {
      const filings = ledgerFilings(host, lead.id, cell.effects(), cell.fact)
      for (const filing of filings) cell.owned.of(filing.player).file(filing)
      return filings
    })
  const room = new NetRoom({ world, step: inputs => cell.step(inputs) }),
    link = directLoopback(),
    client = new NetClient(link.client)
  try {
    room.join(link.server, world.playerOf(lead.id))
    client.hello('', {
      player: 'sdk-placement:author',
      name: 'Placement author',
    })
    link.pump()
    room.open()
    link.pump()
    const tick = interact => {
      const seq = client.command(idle)
      client.flush()
      if (interact !== undefined)
        client.act({ kind: 'interact', seq, id: interact })
      link.pump()
      room.tick()
      link.pump()
      client.present()
    }
    const settle = () => {
      for (let i = 0; i < 16; i++) tick()
    }
    settle()
    await work({ product, host, lead, tick, settle, client })
    assert.equal(client.dropped, 0)
    assert.equal(room.stats.dropped, 0)
  } finally {
    try {
      client.dispose()
    } finally {
      try {
        room.dispose()
      } finally {
        cell.dispose()
      }
    }
  }
}

async function flat(height, work) {
  const rapier = await physics(),
    host = createSimHost(
      {
        ...SIM_LEVEL,
        entities: [],
        quests: [],
        ground: { size: 512, height },
        player: { ...SIM_LEVEL.player, at: { x: 0, y: height, z: 0 } },
      },
      { rapier },
    )
  try {
    host.physics.world.step()
    await work(host)
  } finally {
    host.dispose()
  }
}

// The original synthetic lever's has('met') flip becomes real stock greeting progress on the same public condition law.
timed(
  'actual native greeting unlocks a placed row and both stock tables retain quest law and order',
  async () => {
    await island(async f => {
      const authored = (await f.product.json('quests/interaction-source.json'))
        .constants.interact
      const spots = await f.product.json('server/quest-spots.json'),
        bound = bindInteractPlacements(authored, spots.rows)
      assert.deepEqual(
        bound.rows.map(row => row.id),
        authored.rows.map(row => row.id),
      )
      const key = bound.rows.find(row => row.id === 'hold-key'),
        chest = bound.rows.find(row => row.id === 'castaway-chest')
      assert.ok(chest?.kind === 'chest')
      assert.ok(key?.showWhen?.all?.includes('dead:sailor'))
      assert.ok(chest.requires?.all?.includes('talked:castaway'))
      const rows = {
        external: ['talked:castaway'],
        rows: [
          {
            kind: 'lever',
            id: 'handle',
            label: 'Pull',
            at: { poi: 'world', x: 1, z: 2 },
            requires: { all: ['talked:castaway'] },
            latch: true,
          },
          {
            kind: 'door',
            id: 'gate',
            look: 'sluice',
            w: 2,
            h: 2,
            at: { poi: 'world', x: 2, z: 3 },
            opensWhen: { all: ['lever:handle'] },
          },
        ],
      }
      const sites = [
        { id: 'gate', kind: 'door', x: 20, y: 4, z: 30, yaw: 1 },
        { id: 'handle', kind: 'lever', x: 10, y: 3, z: 20, yaw: 0 },
      ]
      const before = JSON.stringify(rows),
        prepared = bindInteractPlacements(rows, sites),
        handle = prepared.rows[0]
      const expected = {
        external: ['talked:castaway'],
        rows: [
          {
            kind: 'lever',
            id: 'handle',
            label: 'Pull',
            at: { poi: 'world', x: 10, y: 3, z: 20, yaw: 0 },
            requires: { all: ['talked:castaway'] },
            latch: true,
          },
          {
            kind: 'door',
            id: 'gate',
            look: 'sluice',
            w: 2,
            h: 2,
            at: { poi: 'world', x: 20, y: 4, z: 30, yaw: 1 },
            opensWhen: { all: ['lever:handle'] },
          },
        ],
      }
      assert.deepEqual(prepared, expected)
      assert.equal(JSON.stringify(prepared), JSON.stringify(expected))
      assert.equal(JSON.stringify(rows), before)
      assert.deepEqual(
        prepared.rows.map(row => row.id),
        ['handle', 'gate'],
      )
      assert.ok(handle?.kind === 'lever')
      assert.equal(handle.label, 'Pull')
      assert.equal(autoFlag(handle), 'lever:handle')
      const lever = bindInteractionState(handle, f.host.flags)
      assert.notEqual(lever.locked(), null)
      for (const invalid of [
        sites.slice(0, 1),
        [...sites, sites[0]],
        [{ ...sites[0], id: 'foreign' }, sites[1]],
        [{ ...sites[0], kind: 'key' }, sites[1]],
      ])
        assert.throws(() => bindInteractPlacements(rows, invalid))
      assert.throws(() =>
        readInteractPlacements([
          { id: 'bad', kind: 'lever', x: Infinity, y: 0, z: 0, yaw: 0 },
        ]),
      )
      assert.throws(() => readInteractPlacements({}))
      const state = bindInteractionState(chest, f.host.flags)
      assert.notEqual(state.locked(), null)
      assert.equal(f.host.flags.has('talked:castaway'), false)
      f.tick('castaway.talk')
      f.settle()
      assert.equal(f.host.flags.has('talked:castaway'), false)
      // Arrange the actual prompt position; this is not a walked journey or a page render proof.
      f.lead.resetPose(
        {
          x: spots.talk.x,
          y: f.host.groundHeightAt(spots.talk.x, spots.talk.z),
          z: spots.talk.z,
        },
        0,
      )
      f.tick('castaway.talk')
      f.settle()
      assert.equal(f.host.flags.has('talked:castaway'), true)
      assert.equal(state.locked(), null)
      assert.equal(lever.locked(), null)
      assert.equal(f.client.phased.has('talked:castaway'), true)
      assert.equal(f.client.quests.get('sealed-ring')?.started, true)
      const pine = await loadHeadlessProduct('out/pine-hollow'),
        grove = (await pine.json('quests/runtime.json')).table
      const rest = await pine.json('quests/native-spots.json'),
        placed = bindInteractPlacements(grove, rest.rows)
      assert.deepEqual(
        placed.rows.map(row => row.id),
        grove.rows.map(row => row.id),
      )
      assert.ok(
        placed.rows.some(
          row =>
            row.id === 'dam-sluice' &&
            row.kind === 'door' &&
            row.opensWhen?.all?.includes('lever:dam-log-b'),
        ),
      )
      assert.ok(
        placed.rows.some(
          row =>
            row.id.startsWith('resin-') &&
            row.kind === 'pickup' &&
            row.touch === true &&
            row.item === 'amber-resin',
        ),
      )
    })
  },
)

timed(
  'quest floors read real moving colliders and preserve explicit height and anchor precedence',
  async () => {
    await flat(4, host => {
      const box = (id, top) =>
        withOwner(host.scope, () =>
          addPiece(host.physics, {
            id,
            name: id,
            category: 'ground',
            file: 'test/ci/interaction-placement.proof.mjs',
            colliders: [
              {
                kind: 'box',
                x: 0,
                y: top - 0.5,
                z: 0,
                hx: 100,
                hy: 0.5,
                hz: 100,
              },
            ],
          }),
        ).colliders[0]
      const registered = box('registered-floor', 24),
        platform = box('platform', 10)
      assert.ok(registered)
      assert.ok(platform)
      host.physics.world.step()
      const read = only => (x, z) =>
        floorBelow(host.physics, x, z, 100, 200, undefined, only)
      const terrain = read(
          c => c.handle !== registered.handle && c.handle !== platform.handle,
        ),
        registry = { floorAt: read(c => c.handle === registered.handle) }
      const hollow = createQuestPlacements({
          terrain,
          registry,
          registryReach: 20,
        }),
        world = { poi: 'world', x: 5, z: 7, dy: 1 }
      assert.equal(terrain(5, 7), 4)
      assert.equal(registry.floorAt(5, 7), 24)
      assert.equal(hollow.place(world).y, 5)
      registered.setTranslation({ x: 0, y: 22.5, z: 0 })
      host.physics.world.step()
      assert.equal(registry.floorAt(5, 7), 23)
      assert.equal(hollow.place(world).y, 24)
      assert.equal(hollow.place({ ...world, y: 9 }).y, 9)
      // Borrowed author model records remain live. No drawn geometry is claimed for this public data port.
      const model = { anchors: { door: { x: 30, z: 40, yaw: 0.2 } } },
        island = createQuestPlacements({
          terrain,
          platforms: [read(c => c.handle === platform.handle)],
          registry,
          frames: { hut: { x: 12, z: 15, rot: Math.PI / 2 } },
          pois: { hut: model },
        })
      assert.deepEqual(island.place({ poi: 'hut', x: 2, z: 3, yaw: 0.1 }), {
        x: 15,
        y: 23,
        z: 13,
        yaw: Math.PI / 2 + 0.1,
      })
      const door = { poi: 'hut', x: 0, z: 0, anchor: 'hut.door', dy: 2 }
      assert.deepEqual(island.place(door), { x: 30, y: 25, z: 40, yaw: 0.2 })
      model.anchors.door.x = 31
      assert.equal(island.place(door).x, 31)
      island.setAnchor('hut.door', { x: 8, z: 9 })
      assert.deepEqual(island.place(door), { x: 8, y: 23, z: 9, yaw: 0 })
      island.setAnchor('hut.door', { x: 8, y: 7, z: 9, yaw: 0.8 })
      assert.deepEqual(island.place(door), { x: 8, y: 7, z: 9, yaw: 0.8 })
      assert.throws(() => island.place({ ...door, anchor: 'hut.__proto__' }))
      assert.throws(() => island.setAnchor('bad', { x: Infinity, z: 0 }))
      assert.throws(() => island.place({ poi: 'wreck', x: 0, z: 0 }))
      assert.throws(() => island.place({ ...world, dy: Number.NaN }))
      assert.throws(() => createQuestPlacements({ terrain, registryReach: 0 }))
    })
  },
)

timed(
  'authored frame names refuse inherited and unsafe identities at the real native floor',
  async () => {
    await flat(3, host => {
      const terrain = (x, z) => floorBelow(host.physics, x, z, 100, 200)
      const resolver = createQuestPlacements({
        terrain,
        frames: { orchard: { x: 10, z: 20, rot: Math.PI / 2 } },
        pois: {
          orchard: { anchors: { gate: { x: 12, y: 8, z: 24, yaw: 0.3 } } },
        },
      })
      assert.deepEqual(
        resolver.place({ poi: 'orchard', x: 2, z: 3, yaw: 0.1 }),
        { x: 13, y: 3, z: 18, yaw: Math.PI / 2 + 0.1 },
      )
      assert.deepEqual(
        resolver.place({ poi: 'orchard', x: 0, z: 0, anchor: 'orchard.gate' }),
        { x: 12, y: 8, z: 24, yaw: 0.3 },
      )
      assert.throws(
        () => resolver.place({ poi: 'missing', x: 0, z: 0 }),
        /Missing quest frame/,
      )
      assert.throws(
        () => resolver.place({ poi: 'constructor', x: 0, z: 0 }),
        /Invalid quest anchor path/,
      )
      const inherited = createQuestPlacements({
        terrain,
        frames: Object.create({ orchard: { x: 10, z: 20, rot: 0 } }),
      })
      assert.throws(
        () => inherited.place({ poi: 'orchard', x: 0, z: 0 }),
        /Missing quest frame/,
      )
      assert.throws(() =>
        createQuestPlacements({
          terrain,
          frames: { constructor: { x: 0, z: 0, rot: 0 } },
        }),
      )
      assert.throws(
        () =>
          createQuestPlacements({
            terrain,
            frames: Object.fromEntries(
              Array.from({ length: 4097 }, (_, i) => [
                `frame-${i}`,
                { x: 0, z: 0, rot: 0 },
              ]),
            ),
          }),
        /Too many quest frames/,
      )
    })
  },
)
