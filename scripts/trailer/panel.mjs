// The panel beside a replayed session (docs/trailer.md): the pictures the session looked at, each shown from the moment the
// replay reaches it until the next, as one video build-beat.mjs takes with --lapse. Its length is the cast's, so build-beat
// stretches both alike and the pictures land on the terminal lines that read them.
//
//   node scripts/trailer/panel.mjs <images.json> <out.mp4> [--hold <s>] [--w 1600] [--h 900] [--fit contain|cover]
//
// images.json is transcript-cast.mjs's ({ length, images: [{ t, file }] }); --hold adds the beat's end hold so the stretch
// matches build-beat's (the cast fills dur − hold, a panel fills dur). --fit cover fills the panel from a phone's portrait
// capture by its middle band; contain (the default) letterboxes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

/** each picture's span in seconds: from its t (the first from 0) to the next one's, the last to the end
 * @param {{ t: number, file: string }[]} images @param {number} length @returns {{ file: string, dur: number }[]} */
export function spans(images, length) {
  if (images.length === 0) throw new Error('panel: the span read no pictures');
  return images.map((im, k) => {
    const from = k === 0 ? 0 : im.t, to = k + 1 < images.length ? images[k + 1].t : length;
    return { file: im.file, dur: Number(Math.max(0.05, to - from).toFixed(3)) };
  });
}

/** @param {string[]} argv */
export async function main(argv) {
  const [IN, OUT] = argv;
  const opt = (/** @type {string} */ k, /** @type {string} */ d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };
  if (!OUT) { console.error('node scripts/trailer/panel.mjs <images.json> <out.mp4> [--hold <s>]'); return 2; }
  const { length, images } = JSON.parse(readFileSync(IN, 'utf8'));
  const W = Number(opt('w', '1600')), H = Number(opt('h', '900')), hold = Number(opt('hold', '0')), fit = opt('fit', 'contain') === 'cover' ? 'cover' : 'contain';
  const list = spans(images, length);
  list[list.length - 1].dur += hold;
  // every picture to one size and format first: sessions read PNG, JPEG and mislabelled files alike, and the concat
  // demuxer wants one codec
  const dir = resolve(dirname(IN)), norm = `${resolve(OUT)}.frames`, concat = `${OUT}.txt`;
  mkdirSync(norm, { recursive: true });
  for (const [k, s] of list.entries()) {
    await sharp(join(dir, s.file)).resize(W, H, { fit, background: '#050a12' }).flatten({ background: '#050a12' }).jpeg({ quality: 95 }).toFile(`${norm}/${k}.jpg`);
  }
  writeFileSync(concat, `${list.map((s, k) => `file '${norm}/${k}.jpg'\nduration ${s.dur}`).join('\n')}\nfile '${norm}/${list.length - 1}.jpg'\n`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat,
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', OUT], { stdio: 'inherit' });
  console.log(`[panel] ${list.length} pictures, ${(length + hold).toFixed(1)} s → ${OUT}`);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
