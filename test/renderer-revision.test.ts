// J259 (SHARD-PIPELINE SP3): mutation tests for the narrowed renderer fingerprint over this checkout's real tree.
// A one-line edit to the GLSL emitter or to a file that rewrites three's chunks, and a shader-library bump, each move it;
// an edit under scripts/, or to client code that writes no shader text, doesn't.
// oxlint-disable-next-line import/no-nodejs-modules -- Reads this checkout's committed sources.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Checkout paths.
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {CARRIED_RENDERERS, narrowedRendererHash, publishedRenderer, rendererRevision, SHADER_TEXT} from '../scripts/renderer-revision.mjs';
import {committedSourceFiles} from '../scripts/source-input-proof.mjs';

const root = resolve(import.meta.dirname, '..');
const paths = committedSourceFiles(root);
const disk = (path: string): Buffer => readFileSync(resolve(root, path));
const base = narrowedRendererHash(paths, disk);
/** The fingerprint with one file's bytes replaced (or a new file added). */
const edited = (path: string, edit: (text: string) => string, extra: readonly string[] = []): string =>
  narrowedRendererHash([...paths, ...extra], file => file === path ? Buffer.from(edit(extra.includes(path) ? '' : disk(path).toString('utf8'))) : disk(file));
const bump = (name: string): string => edited('package.json', text => {
  const pkg = JSON.parse(text) as {dependencies: Record<string, string>};
  pkg.dependencies[name] = `${pkg.dependencies[name]}-next`;
  return JSON.stringify(pkg);
});
/** A committed client file that writes no shader text, found rather than named so a move can't stale this test. */
const plain = paths.find(path => path.startsWith('src/client/game/') && path.endsWith('.ts') && !/\.(?:test|proof|generated)\./u.test(path) && !SHADER_TEXT.test(disk(path).toString('utf8')));

describe('narrowed renderer fingerprint (J259)', () => {
  it('moves on a one-line edit to the GLSL emitter', () => {
    expect(edited('src/client/engine/render/graph/glsl.ts', text => `${text}\n// one line\n`)).not.toBe(base);
  });
  it('moves on a one-line edit to pointLightSkip.ts, which rewrites ShaderChunk outside render/', () => {
    expect(disk('src/client/engine/world/pointLightSkip.ts').toString('utf8')).toMatch(SHADER_TEXT);
    expect(edited('src/client/engine/world/pointLightSkip.ts', text => `${text}\n// one line\n`)).not.toBe(base);
  });
  // Codex J206 MUST-FIX: shader text with none of the first keywords, constants the GLSL emitter bakes in from
  // src/shared, and a material flag that picks a program variant.
  it.each([
    'src/client/engine/world/painterly.ts', 'src/client/engine/world/backdropLayer.ts',
    'src/shared/engine/world/windField.ts', 'src/shared/engine/world/waves.ts', 'src/client/game/shardfile/bakedKinds.ts',
  ])('moves on a one-line edit to %s', path => {
    expect(edited(path, text => `${text}\n// one line\n`)).not.toBe(base);
  });
  it.each(['three', 'postprocessing', 'n8ao', '@wildshard/format'])('moves on a %s version change', name => {
    expect(bump(name)).not.toBe(base);
  });
  it('picks up a new file that patches shader text on its own', () => {
    expect(edited('src/client/game/newLook.ts', () => 'material.onBeforeCompile = () => {};', ['src/client/game/newLook.ts'])).not.toBe(base);
  });
  it('holds for scripts/, the lockfile, tests and client code with no shader text', () => {
    expect(edited('scripts/gen.mjs', text => `${text}\n// one line\n`)).toBe(base);
    expect(edited('pnpm-lock.yaml', text => `${text}\n# one line\n`)).toBe(base);
    if (plain === undefined) throw new Error('No committed client file without shader text');
    expect(edited(plain, text => `${text}\n// one line\n`)).toBe(base);
    expect(edited('src/client/engine/render/graph/glsl.test.ts', () => 'glsl', ['src/client/engine/render/graph/glsl.test.ts'])).toBe(base);
    expect(bump('hono')).toBe(base);
  });
  it('publishes the carried pre-J259 value only for its own narrowed inputs', () => {
    for (const [narrowed, carried] of Object.entries(CARRIED_RENDERERS)) expect(publishedRenderer(narrowed)).toBe(carried);
    expect(publishedRenderer('0'.repeat(64))).toBe('0'.repeat(64));
    expect(rendererRevision(root)).toBe(publishedRenderer(base));
  });
});
