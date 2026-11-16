// oxlint-disable-next-line import/no-nodejs-modules -- CI-only native product assertions.
import assert from 'node:assert/strict'
// oxlint-disable-next-line import/no-nodejs-modules -- Use the installed immutable physics bytes.
import { readFileSync } from 'node:fs'
// oxlint-disable-next-line import/no-nodejs-modules -- These explicit cases stay outside hooks and Vitest discovery.
import { test } from 'node:test'

// oxlint-disable-next-line import/no-unassigned-import -- Native simulation requires portable Math before static world tables initialize.
import '../../src/shared/engine/core/portableMathFirst.ts'
import { NetClient } from '../../src/client/engine/net/client.ts'
import { NetRoom } from '../../src/server/engine/net/room.ts'
import { SimNetWorld } from '../../src/server/engine/net/simWorld.ts'
import { PlayerStore } from '../../src/server/host/dedicated/playerStore.ts'
import { loadHeadlessFolder } from '../../src/server/host/headlessFolder.ts'
import { openCellWorld } from '../../src/server/host/standalone/cellWorld.ts'
import { ledgerFilings } from '../../src/server/host/standalone/ledgerFilings.ts'
import { loadRapier } from '../../src/shared/engine/physics/rapier.ts'
import { SaveStore } from '../../src/shared/engine/saves/store.ts'
import { actRoutes } from '../../src/shared/engine/sim/actRoutes.ts'
import { leadPlayer } from '../../src/shared/engine/sim/leadPlayer.ts'
import { shardRows } from '../../src/shared/engine/sim/shardRows.ts'
import { netBuys } from '../../src/shared/host/standalone/netInput.ts'
import { directLoopback } from '../../src/test/engine/netLoopback.ts'
import { runtimeAssets } from '../fixtures/engine-lift/folder.ts'

const limit = 9500
const idle = {
  viewTick: 0,
  steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 },
  yaw: Math.PI / 4,
  pitch: 0,
  buttons: 0,
}

async function native(slug, work) {
  const started = performance.now(),
    directory = `out/${slug}`
  const rapier = await loadRapier(
    readFileSync(
      new URL(
        import.meta.resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm'),
      ),
    ),
  )
  const product = await loadHeadlessFolder(directory),
    stores = new Map(),
    rewards = new PlayerStore({}, () => undefined).rewards
  // Real server stores acknowledge their in-process forwarder. This proves transactions, not database durability.
  const slots = id => {
    let value = stores.get(id)
    if (value === undefined) {
      value = new PlayerStore({}, () => undefined).slots
      stores.set(id, value)
    }
    return value
  }
  const profiles = {
    read: id => rewards.read(slug).players[id] ?? null,
    write: (id, state) => {
      const value = rewards.read(slug)
      value.players[id] = state
      return rewards.write(value, slug)
    },
  }
  const cell = await openCellWorld(
    { instance: 'sdk-exchange' },
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
      owned: slots,
      profiles,
    },
  )
  const host = cell.host,
    lead = leadPlayer(host),
    seats = []
  const world = new SimNetWorld(host, 0, () => {
    const filings = ledgerFilings(host, lead.id, cell.effects(), cell.fact)
    for (const filing of filings) cell.owned.of(filing.player).file(filing)
    return filings
  })
  const room = new NetRoom({
    world,
    step: inputs => {
      netBuys(actRoutes(host), inputs)
      cell.step(inputs)
    },
  })
  const join = (body, name) => {
    const link = directLoopback(),
      client = new NetClient(link.client)
    seats.push({ link, client, body })
    room.join(link.server, world.playerOf(body.id))
    client.hello('', { player: `sdk-exchange:${name}`, name })
    link.pump()
    return { link, client, body }
  }
  try {
    const first = join(lead, 'Buyer')
    room.open()
    first.link.pump()
    const tick = (action = {}) => {
      const { attack, buy, interact } = action,
        origin = lead.position.clone()
      origin.y += 1.68
      const target =
        attack === undefined ? undefined : host.entities.get(attack)
      if (attack !== undefined)
        assert.ok(target, 'Attack must name a real current body')
      const command =
        target === undefined
          ? idle
          : {
              ...idle,
              attack: {
                targetId: attack,
                aim: {
                  origin,
                  direction: target.position.clone().sub(origin).normalize(),
                },
              },
            }
      const seq = first.client.command(command)
      first.client.flush()
      if (buy !== undefined) first.client.act({ kind: 'buy', seq, good: buy })
      if (interact !== undefined)
        first.client.act({ kind: 'interact', seq, id: interact })
      for (const seat of seats) seat.link.pump()
      room.tick()
      for (const seat of seats) {
        seat.link.pump()
        seat.client.present()
      }
    }
    // Reliable acts wait for their command or the real room's bounded tick allowance; never call the route directly.
    const settle = () => {
      for (let i = 0; i < 16; i++) tick()
    }
    const fight = target => {
      for (let i = 0; i < 1200 && target.alive; i++) {
        // Arrange close combat at the living target. No route, health, damage, purse or inventory is fabricated.
        const x = target.position.x + 0.3,
          z = target.position.z + 0.3
        lead.resetPose({ x, y: host.groundHeightAt(x, z), z }, Math.PI / 4)
        tick(i % 40 === 0 ? { attack: target.entityId } : {})
      }
      assert.equal(target.alive, false, `Real ${target.kind} did not die`)
      settle()
    }
    const lines = (player = lead.id) => {
      const out = new Map()
      for (const read of shardRows(host).owned.values()) read(player, out)
      return out
    }
    settle()
    await work({
      cell,
      host,
      lead,
      product,
      room,
      client: first.client,
      tick,
      settle,
      fight,
      lines,
      join,
    })
    for (const { client } of seats) assert.equal(client.dropped, 0)
    assert.equal(room.stats.dropped, 0)
  } finally {
    try {
      for (const { client } of seats) client.dispose()
    } finally {
      try {
        room.dispose()
      } finally {
        cell.dispose()
      }
    }
  }
  assert.ok(
    performance.now() - started < limit,
    'Complete native exchange proof exceeds 9.5 seconds',
  )
}

void test(
  'earned Driftwood coins refuse a short card and pay before its once-only replicated grant',
  { timeout: limit },
  async () => {
    await native('driftwood-isle', f => {
      const goods = f.product.shardfile.rows.loot.find(
        row => row.economy?.exchange !== undefined,
      )?.economy.exchange.goods
      assert.ok(goods)
      const offer = goods.findIndex(good => good.id === 'whetstone-1')
      assert.ok(offer !== -1)
      assert.equal(goods[offer].costs[0].n, 12)
      // Real combat can grant unrelated drops too; observe this card's actual ownership transition.
      const own = f.cell.owned.of(f.lead.id),
        balances = [],
        stop = own.owned.onChange(() => {
          if (own.owned.has('whetstone-1')) balances.push(own.purse.coins)
        })
      try {
        assert.equal(own.purse.coins, 0)
        assert.equal(f.client.owned.get('coins') ?? 0, 0)
        const bodies = [...f.host.entities.values()],
          crabs = bodies.filter(body => body.kind === 'crab'),
          boars = bodies
            .filter(body => body.kind === 'boar' && body.hp === 70)
            .sort((a, b) => b.position.x - a.position.x),
          sailor = bodies.find(body => body.kind === 'sailor')
        assert.equal(crabs.length, 9)
        assert.equal(boars.length, 5)
        assert.ok(sailor)
        for (const body of crabs) f.fight(body)
        f.fight(boars[0])
        assert.equal(own.purse.coins, 11)
        assert.equal(f.client.owned.get('coins'), 11)
        f.tick({ buy: offer })
        f.settle()
        assert.equal(own.purse.coins, 11)
        assert.equal(own.owned.has('whetstone-1'), false)
        assert.deepEqual(balances, [])
        assert.equal(f.client.owned.get('coins'), 11)
        for (const body of boars.slice(1)) f.fight(body)
        f.fight(sailor)
        assert.equal(own.purse.coins, 24)
        f.tick({ buy: offer })
        f.settle()
        assert.deepEqual(
          balances,
          [12],
          'The real grant callback must observe the already-paid purse',
        )
        assert.equal(own.purse.coins, 12)
        assert.equal(own.owned.has('whetstone-1'), true)
        assert.equal(f.client.owned.get('coins'), 12)
        assert.equal(f.client.owned.get('own.whetstone-1'), 1)
        f.tick({ buy: offer })
        f.settle()
        assert.deepEqual(balances, [12])
        assert.equal(own.purse.coins, 12)
        assert.equal(f.client.owned.get('coins'), 12)
      } finally {
        stop()
      }
    })
  },
)

void test(
  'Pine barter preserves an incomplete earned price and charges only its actual buying seat',
  { timeout: limit },
  async () => {
    await native('pine-hollow', async f => {
      const goods = f.product.shardfile.rows.loot.find(
        row => row.economy?.exchange !== undefined,
      )?.economy.exchange.goods
      assert.ok(goods)
      const offer = goods.findIndex(good => good.id === 'broadheads')
      assert.ok(offer !== -1)
      const boar = [...f.host.entities.values()]
        .filter(body => body.kind === 'boar' && body.alive)
        .sort((a, b) => a.hp - b.hp)[0]
      assert.ok(boar)
      f.fight(boar)
      f.lead.resetPose(
        { x: boar.position.x, y: boar.position.y, z: boar.position.z },
        0,
      )
      f.tick({ interact: `harvest.${boar.entityId}` })
      f.settle()
      assert.equal(f.lines().get('item.boar-hide'), 1)
      assert.equal(f.lines().get('item.amber-resin') ?? 0, 0)
      const before = f.lines().get('ammo.broadhead')
      assert.equal(before, 1)
      f.tick({ buy: offer })
      f.settle()
      assert.equal(f.lines().get('item.boar-hide'), 1)
      assert.equal(f.lines().get('ammo.broadhead'), before)
      const spots = (await f.product.json('quests/native-spots.json')).rows
        .filter(row => row.id.startsWith('resin-'))
        .slice(0, 2)
      assert.equal(spots.length, 2)
      for (const spot of spots) {
        f.lead.resetPose(
          { x: spot.x, y: f.host.groundHeightAt(spot.x, spot.z), z: spot.z },
          0,
        )
        f.settle()
      }
      assert.equal(f.lines().get('item.amber-resin'), 2)
      assert.equal(f.client.owned.get('item.boar-hide'), 1)
      assert.equal(f.client.owned.get('item.amber-resin'), 2)
      const other = f.join(f.host.addPlayer('exchange.other'), 'Other')
      f.settle()
      other.client.act({ kind: 'buy', seq: 0, good: offer })
      f.settle()
      assert.equal(f.lines().get('item.boar-hide'), 1)
      assert.equal(f.lines().get('item.amber-resin'), 2)
      assert.equal(f.lines().get('ammo.broadhead'), before)
      assert.equal(f.lines(other.body.id).get('ammo.broadhead'), 1)
      f.tick({ buy: offer })
      f.settle()
      assert.equal(f.lines().get('item.boar-hide') ?? 0, 0)
      assert.equal(f.lines().get('item.amber-resin') ?? 0, 0)
      assert.equal(f.lines().get('ammo.broadhead'), 9)
      assert.equal(f.client.owned.get('item.boar-hide') ?? 0, 0)
      assert.equal(f.client.owned.get('item.amber-resin') ?? 0, 0)
      assert.equal(f.client.owned.get('ammo.broadhead'), 9)
      assert.equal(f.lines(other.body.id).get('ammo.broadhead'), 1)
      assert.equal(other.client.owned.get('ammo.broadhead'), 1)
    })
  },
)
