/** S12c: the cook's ASTC 6×6 encoder (`Astc6Encode`), S4's hand-made phone sets done by the cook. S4 baked them with
 * `basisu -ldr_6x6 -effort 4` from source images (sharddev `scripts/bake-astc6.mjs`); a cook has no source images, only
 * the shard's UASTC masters, so it decodes the master (already trimmed to its tier size, every level the master's own)
 * to RGBA with basisu's own transcoder (`-export_dds RGBA32`) and encodes those levels as 6×6 with S4's flags. That
 * re-encodes lossy data, so goldens judge it (G998).
 *
 * Cached by input hash (C4): the key is the input bytes, the role, the flags and basisu's version, and a hit reads the
 * file back without running basisu. `stats` counts both, so a warm recook can prove it encoded nothing. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {join} from 'node:path';
import type {Astc6Encode, TextureRole} from './tierTextures';

/** S4's 6×6 classes (`bake-astc6.mjs` CLASS), effort 4 of 10. */
const ROLE_FLAGS: Readonly<Record<TextureRole, readonly string[]>> = {srgb: ['-srgb'], linear: ['-linear'], normal: ['-normal_map']};
const ENCODE_FLAGS = ['-ktx2', '-ldr_6x6', '-effort', '4'];

export interface Astc6Cache {
  readonly encode: Astc6Encode;
  readonly stats: {encoded: number; reused: number; failed: number};
}

/** A basisu-backed `Astc6Encode` caching its files in `cacheDir`. Throws at once when basisu isn't on the PATH. */
export function basisuAstc6(cacheDir: string, basisu = 'basisu'): Astc6Cache {
  const version = /v[\d.]+/u.exec(execFileSync(basisu, ['-version'], {encoding: 'utf8'}))?.[0] ?? '?';
  mkdirSync(cacheDir, {recursive: true});
  const stats = {encoded: 0, reused: 0, failed: 0};
  const encode: Astc6Encode = (ktx2, role) => {
    const key = createHash('sha256').update(`astc6/1|${version}|${ENCODE_FLAGS.join(' ')}|${ROLE_FLAGS[role].join(' ')}|`).update(ktx2).digest('hex');
    const cached = join(cacheDir, `${key}.ktx2`);
    if (existsSync(cached)) { stats.reused++; return new Uint8Array(readFileSync(cached)); }
    const work = mkdtempSync(join(cacheDir, 'work-'));
    try {
      const input = join(work, 'in.ktx2'), levels = join(work, 'in.dds'), output = join(work, 'out.ktx2');
      writeFileSync(input, ktx2);
      execFileSync(basisu, ['-export_dds', 'RGBA32', input, '-output_file', levels], {stdio: 'ignore'});
      execFileSync(basisu, [...ENCODE_FLAGS, ...ROLE_FLAGS[role], levels, '-output_file', output], {stdio: 'ignore'});
      const bytes = new Uint8Array(readFileSync(output));
      renameSync(output, cached);
      stats.encoded++;
      return bytes;
    } catch {
      stats.failed++;
      return undefined;
    } finally {
      rmSync(work, {recursive: true, force: true});
    }
  };
  return {encode, stats};
}
