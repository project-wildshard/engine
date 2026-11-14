// Explicit owner contracts, outside Vitest and hooks. No DOM, renderer or live server.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  InputExtraSchema,
  inputWhenMatches,
} from '@wildshard/format/inputDeclarations'
import { parseItems } from '@wildshard/format/items'
import {
  migrateEquipmentSlots,
  parseMigrations,
} from '@wildshard/format/migrations'
import { parsePlumbing } from '@wildshard/format/plumbing'
import * as v from 'valibot'

import {
  TIER,
  TIER_CONFIG,
  initializeTier,
  applyLevelTier,
  buildTier,
} from '../../src/client/engine/core/tier.ts'
import { withTier } from '../../src/client/engine/explore/tiers.ts'
import { InputService } from '../../src/client/engine/input/InputService.ts'
import { CosmeticsLocker } from '../../src/client/game/cosmetics/locker.ts'
import {
  installDeclaredPlumbing,
  plumbingKnob,
} from '../../src/client/game/shard/declaredPlumbing.ts'
import { ForwardedStorage } from '../../src/server/engine/saves/forwardedStorage.ts'
import { loadHeadlessFolder } from '../../src/server/host/headlessFolder.ts'
import { Scope } from '../../src/shared/engine/app/scope.ts'
import { SaveStore } from '../../src/shared/engine/saves/store.ts'
import { declaredItemContext } from '../../src/shared/game/shardfile/items.ts'

function timed(name, work) {
  void test(name, { timeout: 9500 }, async () => {
    const start = performance.now()
    await work()
    assert.ok(
      performance.now() - start < 9500,
      'Complete declared-input case exceeds 9.5 seconds',
    )
  })
}
// A fictional author declaration exercises the public host, without changing shipped content.
const rows = {
  namespace: 'harbour',
  debug: [],
  knobs: [
    { id: 'harbour.sprayScale', phone: 0.5, desktop: 1 },
    { id: 'harbour.sprayShadows', phone: false, desktop: true },
  ],
  input: [
    {
      id: 'harbour.sail',
      priority: 20,
      keysFrom: 'weapon.melee',
      actions: [
        { id: 'attack' },
        { id: 'harbour.horn', keys: ['KeyG'], scene: 'harbour.soundHorn' },
      ],
      blocks: ['aim'],
      when: {
        mode: 'board',
        item: 'weapon.harbour.sail',
        flag: 'harbour.castOff',
      },
      relabel: { r0: { label: 'Furl', tone: 'ready' } },
      verbs: {
        'verb.1': { action: 'harbour.horn', label: 'Horn', icon: 'bell' },
      },
      describe: [
        {
          group: 'combat',
          id: 'harbour.horn',
          label: 'Sound horn',
          actions: ['harbour.horn'],
        },
      ],
    },
  ],
}

timed(
  'actual conditional commands inherit keys and cannot call retired or inactive scenes',
  () => {
    const scope = new Scope('declared-input'),
      input = new InputService(() => 0),
      scenes = []
    let context
    try {
      input.register(
        { id: 'weapon.melee', actions: ['attack'], keys: { attack: ['KeyF'] } },
        scope,
      )
      const state = { mode: 'foot', item: 'weapon.harbour.sail', flags: [] }
      const handles = installDeclaredPlumbing(parsePlumbing(rows), {
        instance: 'harbour',
        tier: 'phone',
        scope,
        input,
        active: () => true,
        scene: id => {
          scenes.push(id)
        },
        knobs: schema => {
          assert.equal(schema.defaults['harbour.sprayScale'], 0.5)
        },
        debugRow: () => {
          throw new Error('Unexpected Debug row')
        },
        observation: state,
      })
      context = handles.contexts.get('harbour.sail')
      assert.ok(context)
      assert.equal(input.active(context), false)
      assert.deepEqual(input.bindings.defaultKeys(context).attack, ['KeyF'])
      input.executeCommand({ kind: 'press', action: 'harbour.horn', at: 0 })
      assert.deepEqual(scenes, [])
      state.mode = 'board'
      handles.update()
      assert.equal(input.active(context), false)
      input.executeCommand({ kind: 'press', action: 'harbour.horn', at: 0.5 })
      assert.deepEqual(scenes, [])
      state.flags.push('harbour.castOff')
      handles.update()
      assert.equal(input.active(context), true)
      assert.equal(input.allowed('aim'), false)
      input.executeCommand({ kind: 'press', action: 'harbour.horn', at: 1 })
      assert.deepEqual(scenes, ['harbour.soundHorn'])
      state.item = 'weapon.harbour.oar'
      handles.update()
      assert.equal(input.active(context), false)
      input.executeCommand({ kind: 'press', action: 'harbour.horn', at: 2 })
      assert.equal(scenes.length, 1)
      assert.equal(handles.knob('harbour.sprayScale'), 0.5)
      assert.equal(handles.knob('harbour.sprayShadows'), false)
      assert.throws(
        () => handles.knob('harbour.missing'),
        /Unknown declared knob/,
      )
      assert.throws(() => handles.knob('constructor'), /Unknown declared knob/)
      state.item = 'weapon.harbour.sail'
      handles.update()
      assert.equal(input.active(context), true)
    } finally {
      scope.dispose()
    }
    assert.equal(input.has(context), false)
    assert.equal(input.bindings.table.rows.length, 0)
    input.executeCommand({ kind: 'press', action: 'harbour.horn', at: 3 })
    assert.equal(scenes.length, 1)
  },
)

timed('mode, item and flag conditions remain a conjunction', () => {
  const state = {
    mode: 'board',
    item: 'weapon.harbour.sail',
    flags: ['harbour.castOff'],
  }
  assert.equal(inputWhenMatches(rows.input[0].when, state), true)
  assert.equal(inputWhenMatches({ notMode: 'board' }, state), false)
  assert.equal(inputWhenMatches({ flag: 'harbour.docked' }, state), false)
  assert.equal(
    inputWhenMatches(
      { mode: 'board', notMode: 'swim', item: 'weapon.harbour.sail' },
      state,
    ),
    true,
  )
})

timed(
  'author admission rejects executable or foreign input without executing accessors',
  () => {
    assert.throws(() =>
      parsePlumbing({
        ...rows,
        knobs: [{ id: 'harbour.scale', phone: false, desktop: 1 }],
      }),
    )
    assert.throws(() =>
      parsePlumbing({
        ...rows,
        input: [{ ...rows.input[0], actions: [{ id: 'another.horn' }] }],
      }),
    )
    assert.throws(() =>
      parsePlumbing({
        ...rows,
        input: [{ ...rows.input[0], when: { predicate: () => true } }],
      }),
    )
    assert.throws(() =>
      parsePlumbing({
        ...rows,
        input: [
          {
            ...rows.input[0],
            verbs: {
              'verb.1': {
                action: 'harbour.missing',
                label: 'Bad',
                icon: 'bad',
              },
            },
          },
        ],
      }),
    )
    let called = false
    const executable = { ...rows }
    Object.defineProperty(executable, 'namespace', {
      enumerable: true,
      get: () => {
        called = true
        return 'harbour'
      },
    })
    assert.throws(() => parsePlumbing(executable))
    assert.equal(called, false)
    assert.equal(
      v.parse(InputExtraSchema, {
        actions: [{ id: 'harbour.horn', keys: ['KeyG'] }],
        hiddenWhen: { mode: 'board' },
      }).actions.length,
      1,
    )
    assert.throws(() => v.parse(InputExtraSchema, { show: () => true }))
  },
)

timed('weapon extras retain real binding and closed visibility', () => {
  const data = parseItems({
    version: 1,
    rows: [],
    contexts: [
      {
        id: 'harbour.sail',
        keysFrom: 'weapon.melee',
        actions: ['attack', 'heavy', 'lock'],
        touch: 'melee',
        lockable: true,
        extra: {
          actions: [{ id: 'harbour.horn', keys: ['KeyG'] }],
          hiddenWhen: { mode: 'board' },
          relabel: { r0: { label: 'Furl' } },
          verbs: {
            'verb.1': { action: 'harbour.horn', label: 'Horn', icon: 'bell' },
          },
        },
      },
    ],
    loadout: { primary: null, secondary: null, tools: [] },
  })
  const state = { mode: 'foot', item: null, flags: [] },
    row = data.contexts[0]
  assert.ok(row)
  const definition = declaredItemContext(row, state)
  assert.deepEqual(definition.actions, [
    'attack',
    'heavy',
    'lock',
    'harbour.horn',
  ])
  assert.deepEqual(definition.keys?.['harbour.horn'], ['KeyG'])
  assert.equal(definition.touch?.relabel.r0?.label, 'Furl')
  const verb = definition.touch?.verbs?.['verb.1']
  assert.equal(typeof verb, 'object')
  assert.equal(verb.show(), true)
  state.mode = 'board'
  assert.equal(verb.show(), false)
  assert.throws(() => declaredItemContext(row), /host observations/)
})

const cosmeticKey = {
  key: 'skins',
  scope: 'shard',
  version: 1,
  schema: v.object({
    owned: v.array(v.string()),
    worn: v.record(v.string(), v.string()),
  }),
  initial: () => ({ owned: [], worn: {} }),
}
timed(
  'legacy cosmetic migration survives actual SaveStore and forwarded document reload exactly once',
  async () => {
    for (const [from, to] of [
      ['far-fan', 'declared.weapon.far-reach.fan'],
      ['sunscar-whip', 'declared.weapon.sunscar-whip'],
    ]) {
      const writes = [],
        documents = {},
        storage = new ForwardedStorage({}, row => {
          writes.push(row)
        })
      const flush = async () => {
        for (const row of writes) {
          if (row.value === null) delete documents[row.key]
          else documents[row.key] = row.value
          storage.acked(row.seq, true)
        }
        assert.equal(await storage.settled(), true)
      }
      const slot = new SaveStore({ local: storage, session: null }).define(
        cosmeticKey,
      )
      assert.equal(
        slot.write(
          { owned: ['old-skin', 'new-skin'], worn: { [from]: 'old-skin' } },
          'harbour',
        ),
        true,
      )
      await flush()
      const before = writes.length
      const migrations = parseMigrations([
        { from: 1, to: 2, fields: [], equipmentSlots: [{ from, to }] },
      ])
      const skins = [
        { id: 'old-skin', slot: to },
        { id: 'new-skin', slot: to },
      ]
      const delegated = []
      const observe = save => ({
        read: namespace => save.read(namespace),
        write: (value, namespace) => {
          delegated.push({ value: structuredClone(value), namespace })
          return save.write(value, namespace)
        },
      })
      const restored = new CosmeticsLocker('harbour', skins, {
        migrations,
        slot: row => row.slot,
        save: observe(slot),
      })
      assert.equal(restored.wearing(to)?.id, 'old-skin')
      assert.deepEqual(slot.read('harbour').worn, { [to]: 'old-skin' })
      assert.equal(writes.length - before, 1)
      assert.deepEqual(delegated, [
        {
          value: {
            owned: ['old-skin', 'new-skin'],
            worn: { [to]: 'old-skin' },
          },
          namespace: 'harbour',
        },
      ])
      await flush()
      const reloadedWrites = [],
        reloaded = new ForwardedStorage(documents, row => {
          reloadedWrites.push(row)
        })
      const reloadedSlot = new SaveStore({
        local: reloaded,
        session: null,
      }).define(cosmeticKey)
      const again = new CosmeticsLocker('harbour', skins, {
        migrations,
        slot: row => row.slot,
        save: observe(reloadedSlot),
      })
      assert.equal(again.wearing(to)?.id, 'old-skin')
      assert.equal(reloadedWrites.length, 0)
      assert.equal(
        delegated.length,
        1,
        'Store deduplication must not hide a repeated locker save call',
      )
      assert.equal(await reloaded.settled(), true)
      const collision = { [from]: 'old-skin', [to]: 'new-skin' }
      assert.deepEqual(migrateEquipmentSlots(collision, migrations), {
        [to]: 'new-skin',
      })
      assert.equal(collision[from], 'old-skin')
    }
  },
)

timed(
  'quality defaults and namespaced overrides keep scalar kind and identity',
  () => {
    assert.equal(
      plumbingKnob(rows, 'phone', 'harbour.sprayScale', 'number'),
      0.5,
    )
    assert.equal(
      plumbingKnob(rows, 'desktop', 'harbour.sprayShadows', 'boolean'),
      true,
    )
    assert.equal(
      plumbingKnob(rows, 'phone', 'harbour.sprayScale', 'number', {
        'harbour.sprayScale': 0.375,
      }),
      0.375,
    )
    assert.throws(() =>
      plumbingKnob(rows, 'phone', 'harbour.missing', 'number', {
        'harbour.missing': 1,
      }),
    )
    assert.throws(() =>
      plumbingKnob(rows, 'phone', 'harbour.sprayScale', 'boolean'),
    )
    assert.throws(() =>
      plumbingKnob(rows, 'phone', 'harbour.sprayScale', 'number', {
        'harbour.sprayScale': Infinity,
      }),
    )
  },
)

timed(
  'migration readers reject getters before running them and preserve prototype safety',
  () => {
    const step = { from: 1, to: 2, fields: [] }
    let called = false
    Object.defineProperty(step, 'equipmentSlots', {
      enumerable: true,
      get: () => {
        called = true
        return []
      },
    })
    assert.throws(() => parseMigrations([step]))
    assert.equal(called, false)
    const worn = {}
    Object.defineProperty(worn, 'old', {
      enumerable: true,
      get: () => {
        called = true
        return 'skin'
      },
    })
    assert.throws(() => migrateEquipmentSlots(worn, []))
    assert.equal(called, false)
    assert.deepEqual(
      migrateEquipmentSlots(
        {},
        parseMigrations([
          {
            from: 1,
            to: 2,
            fields: [],
            equipmentSlots: [
              { from: 'constructor', to: 'declared.weapon.harbour.sail' },
            ],
          },
        ]),
      ),
      {},
    )
  },
)

timed(
  'actual pinned Pine and Nine tier policies survive trim and alternate-tier construction',
  async () => {
    const saved = { ...TIER_CONFIG },
      savedTier = TIER
    try {
      const plumbing = (await loadHeadlessFolder('out/pine-hollow')).shardfile
        .plumbing
      const nine = (await loadHeadlessFolder('out/nine-dragon-stack'))
        .shardfile.plumbing
      assert.equal(plumbingKnob(nine, 'phone', 'nine.paintSize', 'number'), 512)
      assert.equal(
        plumbingKnob(nine, 'desktop', 'nine.paintSize', 'number'),
        1024,
      )
      assert.equal(
        plumbingKnob(nine, 'phone', 'nine.decalScale', 'number'),
        0.5,
      )
      assert.equal(
        plumbingKnob(nine, 'desktop', 'nine.decalScale', 'number'),
        1,
      )
      initializeTier('phone')
      assert.equal(
        plumbingKnob(
          plumbing,
          buildTier(),
          'pine.cabinDetailDist',
          'number',
          TIER_CONFIG,
        ),
        70,
      )
      applyLevelTier({ 'pine.cabinDetailDist': 52.5 })
      assert.equal(
        plumbingKnob(
          plumbing,
          buildTier(),
          'pine.cabinDetailDist',
          'number',
          TIER_CONFIG,
        ),
        52.5,
      )
      assert.equal(
        withTier('desktop', () =>
          plumbingKnob(
            plumbing,
            buildTier(),
            'pine.cabinDetailDist',
            'number',
            TIER_CONFIG,
          ),
        ),
        160,
      )
      assert.equal(
        plumbingKnob(
          plumbing,
          buildTier(),
          'pine.cabinDetailDist',
          'number',
          TIER_CONFIG,
        ),
        52.5,
      )
      applyLevelTier(undefined)
      assert.equal(
        plumbingKnob(
          plumbing,
          buildTier(),
          'pine.cabinDetailDist',
          'number',
          TIER_CONFIG,
        ),
        70,
      )
      initializeTier('desktop')
      assert.equal(
        plumbingKnob(
          plumbing,
          buildTier(),
          'pine.cabinDetailShadows',
          'boolean',
          TIER_CONFIG,
        ),
        true,
      )
    } finally {
      initializeTier(savedTier)
      Object.assign(TIER_CONFIG, saved)
    }
  },
)
