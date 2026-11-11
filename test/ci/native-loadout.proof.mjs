// oxlint-disable-next-line import/no-nodejs-modules -- CI-only native product assertions.
import assert from 'node:assert/strict'
// oxlint-disable-next-line import/no-nodejs-modules -- Use the installed immutable physics bytes.
import { readFileSync } from 'node:fs'
// oxlint-disable-next-line import/no-nodejs-modules -- Explicit CI cases stay outside hooks and Vitest discovery.
import { test } from 'node:test'

import { parseNativeSweptMeleeBinding } from '@wildshard/format/items'
import { parseNativeLoadoutRow } from '@wildshard/format/nativeItems'
import { Vector3 } from 'three'

// oxlint-disable-next-line import/no-unassigned-import -- Native simulation requires portable Math before static world tables initialize.
import '../../src/shared/engine/core/portableMathFirst.ts'
import { NetClient } from '../../src/client/engine/net/client.ts'
import { NetRoom } from '../../src/server/engine/net/room.ts'
import { SimNetWorld } from '../../src/server/engine/net/simWorld.ts'
import { createSimHost } from '../../src/server/engine/sim.ts'
import { nativeGroundBossObservation } from '../../src/server/game/boss/native.ts'
import { createNativeCombatFrame } from '../../src/server/game/plugin/nativeItems.ts'
import {
  bindNativeLoadout,
  createNativeLoadout,
} from '../../src/server/game/plugin/simulation.ts'
import { PlayerStore } from '../../src/server/host/dedicated/playerStore.ts'
import { loadHeadlessProduct } from '../../src/server/host/headlessProduct.ts'
import { openCellWorld } from '../../src/server/host/standalone/cellWorld.ts'
import { ledgerFilings } from '../../src/server/host/standalone/ledgerFilings.ts'
import { NET_BUTTONS } from '../../src/shared/engine/input/netButtons.ts'
import { loadRapier } from '../../src/shared/engine/physics/rapier.ts'
import { SaveStore } from '../../src/shared/engine/saves/store.ts'
import { actRoutes } from '../../src/shared/engine/sim/actRoutes.ts'
import { leadPlayer } from '../../src/shared/engine/sim/leadPlayer.ts'
import { netWorldInput } from '../../src/shared/host/standalone/netInput.ts'
import { directLoopback } from '../../src/test/engine/netLoopback.ts'
import { runtimeAssets } from '../fixtures/engine-lift/product.ts'
import { SIM_LEVEL } from '../fixtures/sim-level/level.ts'

// TEST-SPEED TS11: an honest wall budget per case, measured on hosted runners (packed ci, tests (2), where this proof
// runs inside the static unit beside e2e). The file's first case pays the cold start: the first native product load,
// Rapier's compile and the JIT. Green hosted runs took it 8.0 s, and two runs on 2026-11-11 (43069655147 on main, and
// SC1's branch) passed 9.5 s and went red. The warm cases took 0.7-0.9 s. Cold: 20 s; warm: 9.5 s as before.
const limit = 9500,
  coldLimit = 20_000
const idle = {
  viewTick: 0,
  steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 },
  yaw: Math.PI / 4,
  pitch: 0,
  buttons: 0,
}

let cold = true
async function native(slug, work) {
  // The first native proof in this process pays the cold start (see coldLimit); later ones are warm.
  const budget = cold ? coldLimit : limit
  cold = false
  const started = performance.now(),
    directory = `out/${slug}`
  const rapier = await loadRapier(
    readFileSync(
      new URL(
        import.meta.resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm'),
      ),
    ),
  )
  const product = await loadHeadlessProduct(directory),
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
    { instance: 'sdk-loadout' },
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
      netWorldInput(actRoutes(host), inputs)
      cell.step(inputs)
    },
  })
  const join = (body, name) => {
    const link = directLoopback(),
      client = new NetClient(link.client)
    seats.push({ link, client, body })
    room.join(link.server, world.playerOf(body.id))
    client.hello('', { player: `sdk-loadout:${name}`, name })
    link.pump()
    return { link, client, body }
  }
  try {
    const first = join(lead, 'Buyer')
    room.open()
    first.link.pump()
    const tick = (action = {}) => {
      const { interact, equip, buttons, time, free, reload } = action,
        origin = lead.position.clone()
      origin.y += 1.68
      const direction = free?.clone().sub(origin).normalize()
      const aimed =
        direction === undefined
          ? idle
          : {
              ...idle,
              attack: { aim: { origin, direction } },
              yaw: Math.atan2(-direction.x, -direction.z),
              pitch: Math.asin(direction.y),
            }
      const seq = first.client.command({ ...aimed, buttons: buttons ?? 0 })
      first.client.flush()
      if (reload !== undefined)
        first.client.act({ kind: 'reload', seq, slot: reload })
      if (equip !== undefined)
        first.client.act({ kind: 'equip', seq, slot: equip })
      if (time !== undefined)
        first.client.act({
          kind: 'climate',
          seq,
          op: 'time',
          name: time,
          at: -1,
        })
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
    settle()
    await work({
      cell,
      host,
      lead,
      product,
      rapier,
      room,
      client: first.client,
      tick,
      settle,
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
    performance.now() - started < budget,
    `Complete native loadout proof exceeds ${budget / 1000} seconds`,
  )
}

// This is the public author-facing binding port, not a claim that NaN crosses the tick protocol.
// Its flags are the live book of the separate actual Pine world: no flag is set by this oracle.
function publicationProof(rapier, policy, flags) {
  const host = createSimHost(SIM_LEVEL, { rapier }),
    frame = createNativeCombatFrame(),
    live = frame.live,
    armed = frame.armed
  const input = policy.input
  assert.ok(input)
  let locked = false,
    pickup = false,
    consumed = 0,
    tick = 0,
    held = 0,
    swap = null
  const current = bindNativeLoadout(host, policy, {
    flags,
    frame,
    locked: () => locked,
    step: {
      id: input.step,
      phase: input.phase,
      pick: () => {
        consumed++
        return frame.scripts.get(input.command) ?? (pickup ? 1 : null)
      },
    },
  })
  let observed = null
  host.onStep(
    'proof.after-publication',
    () => {
      observed = [...frame.live]
    },
    undefined,
    'afterBodies',
  )
  const expected = () => ({ held, swap: swap === null ? null : { ...swap } })
  return {
    run(until) {
      for (; tick < until; tick++) {
        locked = tick % 79 < 13
        pickup = tick % 41 === 0
        const explicit = tick % 17 === 0 ? Math.floor(tick / 17) % 4 : null
        const aim = [undefined, Number.NaN, -0.4, 0.8, 1.7, 2][tick % 6]
        frame.scripts.clear()
        if (explicit !== null) frame.scripts.set(input.command, explicit)
        if (aim !== undefined)
          frame.scripts.set(input.publication.aim.command, aim)
        const pick = explicit ?? (pickup ? 1 : null)
        // Frozen slot/clock law, independent of createNativeLoadout (the old test reused its implementation).
        const owned =
          pick === 0 ||
          (pick === 1 && flags.has('owned:lever-rifle')) ||
          (pick === 2 && flags.has('paid:king'))
        if (owned && swap?.to !== pick) {
          if (swap !== null) {
            held = swap.to
            swap = null
          }
          if (pick !== held) swap = { to: pick, t: 0, switched: false }
        }
        if (swap !== null) {
          swap.t += 1 / 60
          if (swap.t >= 0.25 && !swap.switched) {
            held = swap.to
            swap.switched = true
          }
          if (swap.t >= 0.5) swap = null
        }
        host.step()
        assert.deepEqual(current.snapshot(), expected(), `frame ${tick}`)
        assert.equal(
          frame.aim,
          aim === 2
            ? 2
            : aim === undefined || !Number.isFinite(aim)
              ? 0.5
              : Math.min(1, Math.max(0, aim)),
        )
        assert.equal(frame.live, live)
        assert.equal(frame.armed, armed)
        assert.deepEqual(
          [...frame.live],
          !locked && swap === null ? [held] : [],
        )
        assert.deepEqual([...frame.armed], !locked ? [held] : [])
        assert.deepEqual(observed, [...frame.live])
        assert.equal(consumed, tick + 1)
        locked = !locked
        assert.equal(current.live(held), !locked && swap === null)
        assert.equal(current.armed(held), !locked)
        locked = !locked
        if (tick === 330) {
          const saved = JSON.parse(JSON.stringify(expected()))
          current.restore(saved)
          assert.deepEqual(current.snapshot(), saved)
        }
      }
    },
    finish() {
      assert.equal(tick, 1200)
      const before = current.snapshot()
      for (const invalid of [
        { held: 31, swap: null },
        { held: 1, swap: { to: 31, t: 0, switched: false } },
        { held: 1, swap: { to: 0, t: Number.NaN, switched: false } },
      ]) {
        assert.throws(() => current.restore(invalid))
        assert.deepEqual(current.snapshot(), before)
      }
      assert.deepEqual(host.adapters.get(input.step)?.snapshot(), before)
      assert.equal(host.adapters.has(input.publication.step), false)
      const adapter = host.adapters.get(input.step)
      assert.ok(adapter)
      const next = (current.held() + 1) % 3
      current.select(next)
      current.step(1 / 60, null)
      const pending = JSON.parse(JSON.stringify(adapter.snapshot()))
      assert.ok(pending.swap)
      assert.equal(pending.swap.switched, false)
      current.step(0.5, null)
      assert.deepEqual(current.snapshot(), { held: next, swap: null })
      adapter.restore(pending)
      assert.deepEqual(current.snapshot(), pending)
      current.step(0.5, null)
      assert.deepEqual(current.snapshot(), { held: next, swap: null })
    },
    dispose: () => host.dispose(),
  }
}

void test(
  'real Pine inputs earn both gated slots; 1,200 author frames preserve swap, aim and publication laws',
  { timeout: coldLimit },
  async () => {
    await native('pine-hollow', async f => {
      const policy = f.product.shardfile.items.loadout.native
      assert.ok(policy?.input)
      assert.deepEqual(
        {
          slots: policy.slots,
          initial: policy.initial,
          lower: policy.lower,
          raise: policy.raise,
          ownership: policy.ownership,
        },
        {
          slots: [0, 1, 2],
          initial: 0,
          lower: 0.25,
          raise: 0.25,
          ownership: [null, 'owned:lever-rifle', 'paid:king'],
        },
      )
      const frames = publicationProof(f.rapier, policy, f.host.flags)
      try {
        assert.equal(f.host.flags.has('owned:lever-rifle'), false)
        assert.equal(f.host.flags.has('paid:king'), false)
        frames.run(80)
        const pickup = (await f.product.json('quests/native-spots.json')).pickup
        assert.ok(pickup)
        f.lead.resetPose(
          {
            x: pickup.x,
            y: f.host.groundHeightAt(pickup.x, pickup.z),
            z: pickup.z,
          },
          0,
        )
        // The actual pickup earns ownership and selects the rifle through the resident binding.
        f.tick({ interact: 'quest.pickup' })
        f.settle()
        f.settle()
        assert.equal(f.host.flags.has('owned:lever-rifle'), true)
        assert.equal(f.lead.held, 1)
        frames.run(160)
        // A same-stock native encounter earns paid:king. Arrange grounded firing positions, not a walked journey.
        // No health, damage, inventory, boss continuation or reward flag is fabricated; normal death/checkpoints remain active.
        f.lead.resetPose(
          { x: 150, y: f.host.groundHeightAt(150, -28) + 0.1, z: -28 },
          0,
        )
        f.tick({ time: 'night', buttons: NET_BUTTONS.skip })
        f.settle()
        assert.equal(f.lead.held, 1)
        assert.equal(f.client.owner(f.client.latest).held, 1)
        const seen = () => nativeGroundBossObservation(f.host, 'pine.king')
        let fired = -80
        for (
          let tick = 0;
          tick < 12000 && seen()?.boss.state !== 'victory';
          tick++
        ) {
          const current = seen(),
            id = current?.fight.body,
            body = id == null ? undefined : f.host.entities.get(id)
          if (current?.boss.state === 'armed')
            f.lead.resetPose(
              { x: 150, y: f.host.groundHeightAt(150, -28), z: -28 },
              0,
            )
          else if (body?.alive) {
            const x = body.position.x,
              z = body.position.z - 12
            f.lead.resetPose({ x, y: f.host.groundHeightAt(x, z), z }, 0)
          }
          const shot =
            body?.alive &&
            current?.boss.state === 'fight' &&
            current.fight.open > 0.8 &&
            tick - fired >= 80
          if (shot) fired = tick
          const dodge = current?.fight.rings.some(
            w => w.on && w.delay <= 0 && Math.abs(w.r - 12) < 3,
          )
            ? NET_BUTTONS.dodge
            : 0
          f.tick({
            buttons: NET_BUTTONS.skip | dodge,
            ...(shot ? { free: body.headWorld(new Vector3()) } : {}),
            ...(tick - fired === 20 ? { reload: 1 } : {}),
          })
        }
        assert.equal(
          seen()?.boss.state,
          'victory',
          JSON.stringify({
            message: 'Actual same-stock King was not defeated',
            observation: seen(),
            health: f.lead.health.attributes.health,
            flags: [...f.host.flags.all],
            loadout: f.host.adapters.get('pine.loadout')?.snapshot(),
          }),
        )
        assert.equal(f.host.flags.has('dead:king'), true)
        assert.equal(f.host.flags.has('paid:king'), false)
        let reward = f.host.adapters.get('pine.king.reward')?.snapshot()?.point
        for (let i = 0; i < 600 && reward == null; i++) {
          f.tick()
          reward = f.host.adapters.get('pine.king.reward')?.snapshot()?.point
        }
        assert.ok(reward)
        f.lead.resetPose(
          {
            x: reward.x,
            y: f.host.groundHeightAt(reward.x, reward.z),
            z: reward.z,
          },
          0,
        )
        f.tick({ interact: 'pine.king.reward' })
        f.settle()
        assert.equal(f.host.flags.has('paid:king'), true)
        f.tick({ equip: 2 })
        f.settle()
        f.settle()
        assert.equal(f.lead.held, 2)
        assert.equal(f.client.owner(f.client.latest).held, 2)
        frames.run(1200)
        frames.finish()
        const adapter = f.host.adapters.get(policy.input.step)
        assert.ok(adapter)
        assert.deepEqual(adapter.snapshot(), { held: 2, swap: null })
        assert.equal(f.host.adapters.has(policy.input.publication.step), false)
      } finally {
        frames.dispose()
      }
    })
  },
)

void test(
  'both stock kits retain their selection rows and strict author preflight',
  { timeout: limit },
  async () => {
    await native('driftwood-isle', async f => {
      const swords = await f.product.json('server/swords.json'),
        items = f.product.shardfile.items.rows
      const { row } = parseNativeSweptMeleeBinding(swords, items)
      assert.deepEqual(row.selection, {
        slots: [0, 1],
        initial: 0,
        lower: 0,
        raise: 0,
        ownership: [null, null],
      })
      const immediate = createNativeLoadout(row.selection, {
        locked: () => false,
      })
      immediate.select(1)
      assert.deepEqual(immediate.snapshot(), { held: 1, swap: null })
      const pine = (await loadHeadlessProduct('out/pine-hollow')).shardfile
        .items.loadout.native
      assert.ok(pine?.input)
      const input = pine.input
      assert.throws(() =>
        parseNativeSweptMeleeBinding({ ...swords, selection: pine }, items),
      )
      for (const row of [
        { ...pine, slots: [0, 0, 2] },
        { ...pine, ownership: [null] },
        {
          ...pine,
          input: {
            ...input,
            publication: {
              ...input.publication,
              aim: { ...input.publication.aim, min: 1 },
            },
          },
        },
        { ...pine, ownership: [null, '', null] },
        { ...pine, lower: Number.NaN },
      ])
        assert.throws(() => parseNativeLoadoutRow(row))
      const host = createSimHost(SIM_LEVEL, { rapier: f.rapier })
      try {
        assert.throws(
          () =>
            bindNativeLoadout(host, pine, {
              flags: host.flags,
              locked: () => false,
              step: { id: input.step, phase: input.phase, pick: () => null },
            }),
          /combat frame/,
        )
        assert.equal(host.adapters.has(input.step), false)
        assert.throws(
          () => createNativeLoadout(pine, { locked: () => false }),
          /flags/,
        )
      } finally {
        host.dispose()
      }
    })
  },
)

void test(
  'one actual pickup command preserves explicit choice and refuses both unearned slots',
  { timeout: limit },
  async () => {
    await native('pine-hollow', async f => {
      assert.equal(f.host.flags.has('owned:lever-rifle'), false)
      assert.equal(f.host.flags.has('paid:king'), false)
      f.tick({ equip: 1 })
      f.settle()
      f.settle()
      assert.equal(f.lead.held, 0)
      f.tick({ equip: 2 })
      f.settle()
      f.settle()
      assert.equal(f.lead.held, 0)
      const pickup = (await f.product.json('quests/native-spots.json')).pickup
      assert.ok(pickup)
      f.lead.resetPose(
        {
          x: pickup.x,
          y: f.host.groundHeightAt(pickup.x, pickup.z),
          z: pickup.z,
        },
        0,
      )
      f.tick({ interact: 'quest.pickup', equip: 0 })
      f.settle()
      f.settle()
      assert.equal(f.host.flags.has('owned:lever-rifle'), true)
      assert.equal(f.lead.held, 0)
      assert.equal(f.client.owner(f.client.latest).held, 0)
      f.tick({ equip: 1 })
      f.settle()
      f.settle()
      assert.equal(f.lead.held, 1)
      assert.equal(f.client.owner(f.client.latest).held, 1)
      f.tick({ equip: 2 })
      f.settle()
      f.settle()
      assert.equal(f.host.flags.has('paid:king'), false)
      assert.equal(f.lead.held, 1)
      assert.equal(f.client.owner(f.client.latest).held, 1)
    })
  },
)
