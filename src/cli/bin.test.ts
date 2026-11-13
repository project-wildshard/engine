import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { object, parse, record, string } from 'valibot'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const PackedSchema = object({
  version: string(),
  bin: record(string(), string()),
})

interface Packed {
  readonly bin: string
  readonly version: string
}

function packInto(box: string): string {
  const output = execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--silent', '--pack-destination', box],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return path.join(box, output.trim().split('\n').at(-1) ?? '')
}

function readPacked(dir: string): Packed {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(dir, 'package.json'), 'utf8'),
  )
  const pkg = parse(PackedSchema, raw)
  const bin = pkg.bin['engine']
  assert.ok(bin !== undefined, 'package.json has no engine bin')
  return { bin: path.join(dir, bin), version: pkg.version }
}

// The packed tarball goes into a node_modules under the repo's own tmp/: Node then refuses to strip types there,
// as it does in a real install, while bare imports still resolve through the repo's node_modules (no network). That
// includes devDependencies, so this proves type stripping, not that the CLI imports runtime dependencies only.
function installPacked(box: string): Packed {
  const tarball = packInto(box)
  const dir = path.join(box, 'node_modules', '@wildshard', 'engine')
  mkdirSync(dir, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '-C', dir, '--strip-components=1'])
  return readPacked(dir)
}

describe('the packed engine bin', (): void => {
  mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })
  const box = mkdtempSync(path.join(ROOT, 'tmp', 'cli-bin-test-'))
  let packed: Packed = { bin: '', version: '' }
  before((): void => {
    packed = installPacked(box)
  })
  after((): void => {
    rmSync(box, { recursive: true, force: true })
  })

  it('starts with a node shebang', (): void => {
    assert.match(readFileSync(packed.bin, 'utf8'), /^#!\/usr\/bin\/env node\n/u)
  })

  it('runs --help from node_modules', (): void => {
    const run = spawnSync(process.execPath, [packed.bin, '--help'], {
      encoding: 'utf8',
    })

    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /^Usage: engine /u)
  })

  it('runs --version from node_modules', (): void => {
    const run = spawnSync(process.execPath, [packed.bin, '--version'], {
      encoding: 'utf8',
    })

    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout.trim(), packed.version)
  })
})
