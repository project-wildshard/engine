// MMO-SERVER MS2.4a: only a signed staging release can select the cook's tag and build.
import { generateKeyPairSync, sign } from 'node:crypto'

import { expect, test } from 'vitest'

import { signedCookRelease } from '../src/scripts/vps/cook-follow.mjs'

const key = generateKeyPairSync('ed25519')
const publicKey = key.publicKey
  .export({ type: 'spki', format: 'der' })
  .toString('hex')
function release(
  build = 'a'.repeat(40),
  tag = `server-staging-${build}`,
  signature = true,
): string {
  const body = JSON.stringify({
    channel: 'staging',
    serial: 1,
    engineBuild: build,
    saveEpoch: 1,
    shards: [],
    bundle: {
      name: `${tag}/engine-server-${build}.tar.gz`,
      sha256: 'b'.repeat(64),
    },
  })
  return JSON.stringify({
    body,
    signature: signature
      ? sign(null, Buffer.from(body), key.privateKey).toString('hex')
      : '00',
  })
}

test('a matching signed staging tag and build selects the cook checkout', () => {
  const build = 'a'.repeat(40)
  expect(signedCookRelease(release(build), publicKey)).toEqual({
    tag: `server-staging-${build}`,
    build,
  })
})

test('an unsigned, wrong-channel or mismatched-tag release never selects the cook checkout', () => {
  expect(() =>
    signedCookRelease(
      release('a'.repeat(40), `server-staging-${'a'.repeat(40)}`, false),
      publicKey,
    ),
  ).toThrow(/bad signature/u)
  expect(() =>
    signedCookRelease(
      release('a'.repeat(40), `server-staging-${'b'.repeat(40)}`),
      publicKey,
    ),
  ).toThrow(/matching server tag/u)
  const body = JSON.stringify({
    channel: 'production',
    serial: 1,
    engineBuild: 'a'.repeat(40),
    saveEpoch: 1,
    shards: [],
    bundle: {
      name: `server-staging-${'a'.repeat(40)}/server.tar.gz`,
      sha256: 'b'.repeat(64),
    },
  })
  const text = JSON.stringify({
    body,
    signature: sign(null, Buffer.from(body), key.privateKey).toString('hex'),
  })
  expect(() => signedCookRelease(text, publicKey)).toThrow(
    /matching server tag/u,
  )
})
