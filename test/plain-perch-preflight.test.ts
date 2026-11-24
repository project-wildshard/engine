import { readFileSync } from 'node:fs'

import { creaturePerchAdmissionRows } from '@wildshard/format/creaturePerch'
import { parseDecisionScripts } from '@wildshard/format/decisionScripts'
import { expect, test, vi } from 'vitest'

import { SimHost } from '../src/server/engine/sim'
import {
  createShardfileSim,
  prepareShardfileSimRestore,
} from '../src/server/game/plugin/simulation'
import { dataPerchBrains, preflightPlainPerches } from '../src/server/game/shardfile/dataPerchBrains'
import { prepareReturns } from '../src/server/game/shardfile/nativeRuntimeLoans'
import { Scope } from '../src/shared/engine/app/scope'
import { Rng } from '@wildshard/format/seededRng'
import { loadRapier } from '../src/shared/engine/physics/rapier'
import { sha256 } from '../src/shared/game/plugin/moduleHash'
import { ReturnProgram } from '../src/shared/game/population/returnProgram'
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder'
import {
  lendFrozenReturns,
  frozenReturnInline,
} from './fixtures/frozen/returns'
import { liveTitanInline as frozenTitanInline } from './fixtures/liveNalati';
import { perchFixture } from './fixtures/plain-perch'
import { groundFixture } from './fixtures/plain-ground'

const assets = () => new Map<string, Uint8Array>()

test('actual plain preparation admits original VM bytes without a body phase or random draw', () => {
  const shard = perchFixture(),
    before = JSON.stringify(shard)
  const project = vi.spyOn(ReturnProgram.prototype, 'project'),
    random = vi.spyOn(Rng.prototype, 'next')
  try {
    const prepared = preflightPlainPerches(shard, assets())
    expect([...prepared.keys()]).toEqual(['fixture.perch'])
    expect(prepared.get('fixture.perch')?.policy.kind).toBe('fixture.creature')
    expect(project).not.toHaveBeenCalled()
    expect(random).not.toHaveBeenCalled()
    expect(JSON.stringify(shard)).toBe(before)
  } finally {
    project.mockRestore()
    random.mockRestore()
  }
})

const faults = [
  'bite',
  'projectile',
  'score',
  'height',
  'channel',
  'bytes',
  'abi',
  'home',
  'return',
  'reference',
] as const
for (const fault of faults)
  test(`default creation and restore refuse ${fault} before installing a host callback`, async () => {
    const shard = perchFixture(),
      body = shard.creatures.perchBodies?.[0],
      spawn = shard.creatures.spawns[0]
    if (body === undefined || spawn === undefined)
      throw new Error('Missing fixture authority')
    if (fault === 'bite') {
      body.policy.strike = 'missing.bite'
      spawn.strike = 'missing.bite'
    }
    if (fault === 'projectile') body.projectile.strike = 'missing.throw'
    if (fault === 'score') body.policy.score = 'missing.score'
    if (fault === 'height') body.policy.height = 'missing.height'
    if (fault === 'channel') body.policy.heightChannel = 'missing.channel'
    if (fault === 'bytes') body.program.bytes = 'AGFzbQEAAAA='
    if (fault === 'abi') {
      const bytes = Uint8Array.from(Buffer.from('AGFzbQEAAAA=', 'base64'))
      body.program.bytes = Buffer.from(bytes).toString('base64')
      body.program.script.module = `blobs/wasm/${sha256(bytes)}.wasm`
    }
    if (fault === 'home') Reflect.deleteProperty(spawn, 'home')
    if (fault === 'return') body.program.script.on = ['start']
    if (fault === 'reference')
      Reflect.deleteProperty(shard.creatures, 'perchBodies')
    const rapier = await loadRapier(
      readFileSync('public/assets/physics/rapier.wasm'),
    )
    const callbacks = vi.spyOn(SimHost.prototype, 'onStep'),
      random = vi.spyOn(Rng.prototype, 'next')
    try {
      for (const construct of [
        createShardfileSim,
        prepareShardfileSimRestore,
      ]) {
        expect(() =>
          construct(shard, assets(), { rapier, ground: false }),
        ).toThrow(/perch|return/i)
      }
      expect(callbacks).not.toHaveBeenCalled()
      expect(random).not.toHaveBeenCalled()
    } finally {
      callbacks.mockRestore()
      random.mockRestore()
    }
  })

test('ABI-2 preflight owns and retires actual admitted memory without executing a projection', () => {
  const scope = new Scope('perch.preflight.proof')
  const project = vi.spyOn(ReturnProgram.prototype, 'project')
  try {
    expect(() =>
      ReturnProgram.preflight(frozenTitanInline.attack, scope),
    ).not.toThrow()
    const reserved = scope.census
    expect(() =>
      ReturnProgram.preflight(frozenTitanInline.attack, scope),
    ).not.toThrow()
    expect(scope.census).toEqual(reserved)
    const forged = structuredClone(frozenTitanInline.attack)
    forged.v2.bytes = 'AGFzbQEAAAA='
    expect(() => ReturnProgram.preflight(forged, scope)).toThrow(
      'Shared return declaration changed',
    )
    expect(project).not.toHaveBeenCalled()
  } finally {
    project.mockRestore()
    scope.dispose()
  }
  expect(Object.values(scope.census).every(count => count === 0)).toBe(true)
})

test('fresh ABI-2 forgery reaches actual projection hash admission before allocating memory', () => {
  const scope = new Scope('perch.fresh.abi2')
  const forged = structuredClone(frozenTitanInline.attack)
  forged.v2.bytes = 'AGFzbQEAAAA='
  const before = scope.census
  try {
    expect(() => ReturnProgram.preflight(forged, scope)).toThrow(
      'Return projection hash mismatch',
    )
    expect(scope.census).toEqual({ ...before, disposers: before.disposers + 1 })
  } finally {
    scope.dispose()
  }
  expect(Object.values(scope.census).every(count => count === 0)).toBe(true)
})

test('a valid parent loan survives partial local assets and unrelated unloaded return rows', () => {
  const scope = lendFrozenReturns(new Scope('perch.parent.partial'))
  const shard = perchFixture(),
    body = shard.creatures.perchBodies?.[0]
  if (body === undefined) throw new Error('Missing fixture body')
  body.program.bytes = ''
  const artifact = frozenTitanInline.attack.v2.artifact
  const unrelated = {
    id: 'unrelated.projection',
    side: 'sim',
    module: `blobs/wasm/${artifact.hash}.wasm`,
    abi: 2,
    lane: artifact.lane,
    pages: artifact.pages,
    ioBytes: artifact.ioBytes,
    compilerRevision: artifact.compilerRevision,
    admissionRevision: artifact.admissionRevision,
  }
  const sections = new Map([
    ['actors/return-scripts', [frozenReturnInline.script, unrelated]],
  ])
  const local = new Map([
    [
      body.program.script.module.slice('blobs/wasm/'.length, -'.wasm'.length),
      Uint8Array.from(Buffer.from(frozenReturnInline.bytes, 'base64')),
    ],
  ])
  const before = scope.census
  try {
    expect(preflightPlainPerches(shard, local, { scope, sections }).size).toBe(
      1,
    )
    expect(
      preflightPlainPerches(shard, assets(), { scope, sections }).size,
    ).toBe(1)
    expect(scope.census).toEqual(before)
  } finally {
    scope.dispose()
  }
})

test('the real whole-host module cap includes decision modules beside the perch VM', () => {
  const shard = perchFixture()
  const bytes = Uint8Array.from(Buffer.from(frozenReturnInline.bytes, 'base64'))
  const scripts = parseDecisionScripts(
    Array.from({ length: 9 }, (_, index) => {
      const binary = new Uint8Array([...bytes, 0, 2, 1, 65 + index])
      return {
        ...frozenReturnInline.script,
        id: `other.${index}`,
        module: `blobs/wasm/${sha256(binary)}.wasm`,
      }
    }),
  )
  expect(() =>
    preflightPlainPerches(shard, assets(), {
      sections: new Map([['sim/scripts', scripts]]),
    }),
  ).toThrow('perch whole-host instance cap')
})

test('raw native bytes use the real parent loan and leave its scope census unchanged', () => {
  const scope = lendFrozenReturns(new Scope('perch.raw.preflight'))
  const shard = perchFixture(),
    body = shard.creatures.perchBodies?.[0]
  if (body === undefined) throw new Error('Missing fixture body')
  body.program.bytes = ''
  const before = scope.census
  try {
    expect(preflightPlainPerches(shard, assets(), { scope }).size).toBe(1)
    expect(scope.census).toEqual(before)
    expect(() => preflightPlainPerches(shard, assets())).toThrow(
      'raw return module loan',
    )
  } finally {
    scope.dispose()
  }
})

test('the actual consumer uses the admitted reservation and requests real projected values', () => {
  const scope = new Scope('perch.preflight.consumer')
  try {
    ReturnProgram.preflight(frozenTitanInline.attack, scope)
    const program = ReturnProgram.page(frozenTitanInline.attack, scope)
    expect(program.project('bossClamp', { fullHp: 20, share: 0.5 })).toEqual({
      hp: 10,
    })
  } finally {
    scope.dispose()
  }
  expect(Object.values(scope.census).every(count => count === 0)).toBe(true)
})

test('conflicting shared return declarations refuse and retire the entire preparation scope', () => {
  const shard = perchFixture(),
    first = shard.creatures.perchBodies?.[0]
  if (first === undefined) throw new Error('Missing fixture body')
  const second = structuredClone(first)
  second.id = 'fixture.other'
  second.program.script.id = 'fixture.conflict'
  shard.creatures.perchBodies?.push(second)
  const scope = new Scope('perch.conflicting.preparation'),
    before = scope.census
  try {
    expect(() => preflightPlainPerches(shard, assets(), { scope })).toThrow(
      'Shared return declaration changed',
    )
    expect(scope.census).toEqual(before)
  } finally {
    scope.dispose()
  }
})

test('a conflicting existing return consumer refuses before default creation or restore registers work', async () => {
  const shard = perchFixture(),
    body = shard.creatures.perchBodies?.[0]
  if (body === undefined) throw Error('Missing actual perch')
  const other = structuredClone(body.program.script)
  other.id = 'fixture.other.consumer'
  const sections = new Map<string, unknown>([
    ['actors/return-scripts', [other]],
  ])
  const rapier = await loadRapier(
    readFileSync('public/assets/physics/rapier.wasm'),
  )
  const callbacks = vi.spyOn(SimHost.prototype, 'onStep'),
    random = vi.spyOn(Rng.prototype, 'next')
  const opened: { host: SimHost }[] = []
  try {
    for (const construct of [createShardfileSim, prepareShardfileSimRestore])
      expect(() => {
        opened.push(
          construct(shard, assets(), { rapier, ground: false, sections }),
        )
      }).toThrow(/return declaration/i)
    expect(callbacks).not.toHaveBeenCalled()
    expect(random).not.toHaveBeenCalled()
  } finally {
    callbacks.mockRestore()
    random.mockRestore()
    for (const value of opened) value.host.dispose()
  }
})

test('canonical perch inventory rows and an identical actual return consumer share the original declaration', () => {
  const shard = perchFixture(),
    body = shard.creatures.perchBodies?.[0]
  if (body === undefined) throw Error('Missing actual perch')
  const sections = new Map<string, unknown>([
    [
      'actors/return-scripts',
      [...creaturePerchAdmissionRows([body]), body.program.script],
    ],
  ])
  const before = JSON.stringify(shard),
    project = vi.spyOn(ReturnProgram.prototype, 'project'),
    random = vi.spyOn(Rng.prototype, 'next')
  try {
    expect(() =>
      preflightPlainPerches(shard, assets(), { sections }),
    ).not.toThrow()
    expect(project).not.toHaveBeenCalled()
    expect(random).not.toHaveBeenCalled()
    expect(JSON.stringify(shard)).toBe(before)
  } finally {
    project.mockRestore()
    random.mockRestore()
  }
})

test('a declared perch borrows the module already lent by the native return inventory', async () => {
  const shard = perchFixture(), body = shard.creatures.perchBodies?.[0]
  if (body === undefined) throw Error('Missing fixture perch')
  const hash = body.program.script.module.slice('blobs/wasm/'.length, -'.wasm'.length)
  const table = new Map([[hash, Uint8Array.from(Buffer.from(body.program.bytes, 'base64'))]])
  body.program.bytes = ''
  const [alias] = creaturePerchAdmissionRows([body])
  expect(alias?.module).toBe(body.program.script.module)
  expect(alias?.id).not.toBe(body.program.script.id)
  const product = createShardFolder({
    slug: shard.identity.slug, revision: 1, shardfile: shard,
    sections: new Map([['actors/return-scripts', [body.program.script]]]),
    files: new Map(), read: () => Promise.reject(new Error('Unexpected asset read')),
  })
  const lend = await prepareReturns({ product, assets: table })
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))
  const sim = createShardfileSim(groundFixture(), assets(), { rapier, ground: false })
  try {
    lend(sim.host)
    const native = ReturnProgram.native(sim.host, body.program)
    const actor = sim.host.entities.get('fixture.actor')
    const { perchHunter } = dataPerchBrains(sim.host, shard, table)
    if (actor === undefined || perchHunter === undefined) throw Error('Missing perch actor or port')
    expect(() => perchHunter(actor, sim.host).observe(1 / 60)).not.toThrow()
    expect(ReturnProgram.native(sim.host, body.program)).toBe(native)
  } finally {
    sim.dispose()
  }
})

test('canonical inventory aliases cannot change a selected return parameter', () => {
  const shard = perchFixture(),
    body = shard.creatures.perchBodies?.[0]
  if (body === undefined) throw Error('Missing actual perch')
  const [row] = creaturePerchAdmissionRows([body])
  if (row === undefined || row.abi === 2) throw Error('Missing v1 inventory')
  row.params['fixture.extra'] = 1
  const sections = new Map<string, unknown>([['actors/return-scripts', [row]]])
  expect(() => preflightPlainPerches(shard, assets(), { sections })).toThrow(
    /return declaration/i,
  )
})

test('mixed ABI-2 inventory retains actual projection admission and refuses resource drift without a host', () => {
  const shard = perchFixture(),
    body = shard.creatures.perchBodies?.[0]
  if (body === undefined) throw Error('Missing actual perch')
  body.program = structuredClone(frozenTitanInline.attack)
  const binding = ReturnProgram.projectionBindings(body.program),
    signals = Object.values(binding.script.signals),
    channels = Object.values(binding.script.channels)
  if (signals[0] === undefined || channels[0] === undefined)
    throw Error('Missing actual ABI-2 bindings')
  body.policy.score = signals[0]
  body.policy.height = signals[0]
  body.policy.heightChannel = channels[0]
  const [row] = creaturePerchAdmissionRows([body])
  if (row === undefined || row.abi !== 2)
    throw Error('Missing actual ABI-2 inventory')
  const sections = new Map<string, unknown>([['actors/return-scripts', [row]]])
  const scope = new Scope('perch.mixed.abi2'),
    before = scope.census,
    project = vi.spyOn(ReturnProgram.prototype, 'project')
  try {
    expect(() =>
      preflightPlainPerches(shard, assets(), { scope, sections }),
    ).not.toThrow()
    expect(scope.census).toEqual(before)
    expect(project).not.toHaveBeenCalled()
    row.pages = row.pages === 4 ? 3 : row.pages + 1
    expect(() =>
      preflightPlainPerches(shard, assets(), { scope, sections }),
    ).toThrow('Conflicting perch module contracts')
    expect(scope.census).toEqual(before)
  } finally {
    project.mockRestore()
    scope.dispose()
  }
})
