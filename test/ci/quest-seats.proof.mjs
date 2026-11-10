// Explicit CI-only owner cases; real products, physics, input and snapshot wire.
import '../../src/shared/engine/core/portableMathFirst.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { Vector3 } from 'three'

import { loadHeadlessProduct } from '../../src/server/host/headlessProduct.ts'
import { createTrustedHeadlessResident } from '../../src/server/host/headlessRuntime.ts'
import { loadRapier } from '../../src/shared/engine/physics/rapier.ts'
import { cableModes } from '../../src/shared/engine/player/modes.ts'
import { questBooks } from '../../src/shared/engine/quest/players.ts'
import { actRoutes } from '../../src/shared/engine/sim/actRoutes.ts'
import { leadPlayer } from '../../src/shared/engine/sim/leadPlayer.ts'
import {
  serializeSimSnapshot,
  snapshotSimHost,
} from '../../src/shared/engine/sim/snapshot.ts'
import { runtimeAssets } from '../fixtures/engine-lift/product.ts'

const botId = 'sdk-seats:bot'
function timed(name, work) {
  void test(name, { timeout: 9500 }, async () => {
    const start = performance.now()
    await work()
    assert.ok(
      performance.now() - start < 9500,
      'Complete quest-seat case exceeds 9.5 seconds',
    )
  })
}
async function fixture(slug, work) {
  const directory = `out/${slug}`,
    product = await loadHeadlessProduct(directory),
    rapier = await loadRapier(
      readFileSync(
        new URL(
          import.meta.resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm'),
        ),
      ),
    ),
    preparation = {
      product,
      shard: product.shardfile,
      assets: runtimeAssets(product, directory),
      rapier,
    }
  const live = await createTrustedHeadlessResident(preparation)
  try {
    await work(live, product, preparation)
  } finally {
    live.dispose()
  }
}
function use(live, id) {
  const route = actRoutes(live.host).interactions.get(id)
  assert.ok(route, `Missing actual prompt ${id}`)
  live.step([{ kind: 'script', ...route, playerId: botId }])
}
function savedPart(live, player, prefix) {
  const entries = Object.entries(
    questBooks(live.host).exportOf(player).parts,
  ).filter(([id]) => id.startsWith(prefix))
  assert.equal(entries.length, 1, `Expected one ${prefix} continuation`)
  return JSON.parse(entries[0][1])
}
function stand(body, at) {
  body.resetPose({ x: at.x, y: at.y - 1.6, z: at.z }, 0)
}

timed(
  'Driftwood bot earns its own cable finish and preserves an in-flight wire continuation',
  async () => {
    await fixture('driftwood-isle', async (live, product, preparation) => {
      const { host } = live,
        spots = await product.json('server/quest-spots.json'),
        lead = leadPlayer(host),
        spawn = lead.position.clone(),
        bot = host.addPlayer(botId, spots.zipline.prompt),
        cables = cableModes(host.scope)
      use(live, 'zipline')
      assert.equal(cables.seatState('driftwood.zipline', botId).riding, true)
      assert.equal(cables.state('driftwood.zipline').riding, false)
      for (let i = 0; i < 60; i++) live.step([])
      const mid = cables.snapshotSeat('driftwood.zipline', botId)
      assert.ok(mid.s > 0)
      assert.ok(bot.position.z < spots.zipline.top.z)
      const wire = serializeSimSnapshot(snapshotSimHost(host))
      for (
        let i = 0;
        i < 1200 && cables.seatState('driftwood.zipline', botId).riding;
        i++
      )
        live.step([])
      assert.equal(cables.seatState('driftwood.zipline', botId).riding, false)
      assert.equal(questBooks(host).of(botId).flags.has('used:zipline'), true)
      assert.equal(host.flags.has('used:zipline'), false)
      assert.ok(lead.position.distanceTo(spawn) < 1)
      const resumed = await createTrustedHeadlessResident(preparation, wire)
      try {
        questBooks(resumed.host).of(botId)
        const restored = cableModes(resumed.host.scope)
        assert.equal(
          questBooks(resumed.host).of(botId).flags.has('used:zipline'),
          false,
        )
        assert.equal(
          restored.seatState('driftwood.zipline', botId).riding,
          true,
        )
        assert.ok(
          Math.abs(
            restored.snapshotSeat('driftwood.zipline', botId).s - mid.s,
          ) < 5e-6,
        )
        // Compare the genuine future as well as the checkpoint, without awarding a flag by hand.
        for (
          let i = 0;
          i < 1200 && restored.seatState('driftwood.zipline', botId).riding;
          i++
        )
          resumed.step([])
        assert.equal(
          restored.seatState('driftwood.zipline', botId).riding,
          false,
        )
        assert.equal(restored.seatState('driftwood.zipline', botId).atEnd, true)
        assert.equal(
          questBooks(resumed.host).of(botId).flags.has('used:zipline'),
          true,
        )
        assert.equal(resumed.host.flags.has('used:zipline'), false)
      } finally {
        resumed.dispose()
      }
    })
  },
)

timed(
  'Pine bot owns its board and trader while the lead remains closed and an empty purse refuses purchase',
  async () => {
    await fixture('pine-hollow', async (live, product) => {
      const { host } = live,
        lead = leadPlayer(host),
        spots = await product.json('quests/native-spots.json'),
        contracts = await product.json('quests/contracts.json'),
        bot = host.addPlayer(botId, spots.board)
      stand(bot, spots.board)
      live.step([])
      const script = (actorId, value) =>
        live.step([{ kind: 'script', actorId, value, playerId: botId }])
      script(contracts.id, 0)
      assert.equal(savedPart(live, botId, 'board:').open, true)
      assert.equal(savedPart(live, lead.id, 'board:').open, false)
      script(contracts.id, 1)
      assert.equal(savedPart(live, botId, 'board:').open, false)
      const trader = spots.people.find(row => row.kind === 'trader')
      assert.ok(trader)
      stand(bot, trader.prompt)
      live.step([])
      use(live, 'talk.trader')
      for (
        let press = 0;
        press < 40 && !savedPart(live, botId, 'trader:').open;
        press++
      )
        script('pine.interact', 7777)
      assert.equal(savedPart(live, botId, 'trader:').open, true)
      assert.equal(savedPart(live, lead.id, 'trader:').open, false)
      const pack = savedPart(live, botId, 'pack:')
      script('pine.trade', 0)
      assert.deepEqual(savedPart(live, botId, 'pack:'), pack)
      script('pine.trade', -1)
      assert.equal(savedPart(live, botId, 'trader:').open, false)
      assert.notEqual(lead.id, botId)
    })
  },
)

timed(
  'Pine cable drives only its bot motor and releases that seat at the actual endpoint',
  async () => {
    await fixture('pine-hollow', async (live, product) => {
      const { host } = live,
        lead = leadPlayer(host),
        spots = await product.json('quests/native-spots.json'),
        row = product.shardfile.modes.traverse[0]
      assert.equal(row.kind, 'zipline')
      const bot = host.addPlayer(botId, spots.cable.prompt),
        bottom = new Vector3(row.bottom.x, row.bottom.y, row.bottom.z),
        cables = cableModes(host.scope)
      stand(bot, spots.cable.prompt)
      live.step([])
      // Ordinary cable registration occurs through the real quest command, never start()/restore().
      use(live, 'pine.zipline')
      assert.equal(cables.seatState(row.id, botId).riding, true)
      const from = bot.position.distanceTo(bottom)
      for (let i = 0; i < 60; i++) live.step([])
      assert.ok(bot.position.distanceTo(bottom) < from - 1)
      assert.equal(bot.led, true)
      assert.equal(lead.led, false)
      for (let i = 0; i < 3600 && cables.seatState(row.id, botId).riding; i++)
        live.step([])
      assert.equal(cables.seatState(row.id, botId).atEnd, true)
      assert.equal(bot.led, false)
      assert.equal(cables.state(row.id).atEnd, false)
      assert.equal(questBooks(host).of(botId).flags.has('used:ph-zip'), true)
      assert.equal(host.flags.has('used:ph-zip'), false)
    })
  },
)
