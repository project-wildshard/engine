// The conform: an EDL to a graded 1080p60 picture with titles, muxed with the mix (docs/trailer.md). Restored from singleplayer
// scripts/steam-trailer/edit.mjs (cf104912d3^).
//
//   node scripts/trailer/edit.mjs <framesDir> <edl.json> <titlesDir> <mix.wav|-> <out.mp4>
//
// Per clip (edl.clips[]: { shot, in, dur, grade?, flashIn?, fadeOut?, video?, still? }), from the capture's 4K 120 fps JPEGs:
//   tmix over the `sub` sub-frames (a 180° shutter at 2 sub-frames: real motion blur) → every sub-th frame (60 fps)
//   → Lanczos 3840×2160 → 1920×1080 (supersampled AA) → the zone's finishing grade → a near-lossless intermediate.
//   `video`: a finished clip made outside the capture (a build beat), cut in as is; `still`: one frame file held (a smoke cut
//   of dry stills, a hold); shot `black`: held black.
// Then: concat (hard cuts), white flash-frames where a clip asks for one, the title PNG sequences (titles.mjs) at their
// times, a vignette and fine grain under the type, edl.overlays (a corner bug) over a span, and the final H.264 High 1080p60
// (CRF 14, ~30 Mb/s) with 320 kb/s AAC.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';

export const FPS = 60;
// finishing grades: small moves that seat each zone's own look in one film (eq in gamma space, a whisper of split-tone).
// Keyed by zone slug; a clip may name another (`grade: 'night'`); an unknown key is no grade.
export const GRADES = {
  'driftwood-isle': 'eq=contrast=1.04:saturation=1.06:gamma=0.99,colorbalance=rs=-0.01:bs=0.02:rh=0.02:bh=-0.01',
  'nalati-grasslands': 'eq=contrast=1.05:saturation=1.03:gamma=0.98,colorbalance=rs=-0.02:bs=0.03:rh=0.03:gh=0.01:bh=-0.02',
  'pine-hollow': 'eq=contrast=1.07:saturation=1.02:gamma=0.97,colorbalance=rs=-0.03:gs=-0.01:bs=0.04:rh=0.04:gh=0.01:bh=-0.03',
  'nine-dragon-stack': 'eq=contrast=1.04:saturation=1.03:gamma=0.99',
  'sunscar-dunes': 'eq=contrast=1.04:saturation=1.02:gamma=0.99',
  'far-reach': 'eq=contrast=1.04:saturation=1.03:gamma=0.99',
  night: 'eq=contrast=1.08:saturation=0.98:gamma=0.97,colorbalance=rs=-0.02:bs=0.05:rh=0.02:bh=-0.01',
  seat: 'eq=contrast=1.03:saturation=1.02:gamma=0.99',
  none: 'null',
};

/** The 60 fps frames a clip covers, from the cut's absolute times (per-clip rounding would drift over many cuts).
 * @param {{ at: number, dur: number }} c */
export const clipFrames = (c) => Math.round((c.at + c.dur) * FPS) - Math.round(c.at * FPS);

/** The per-clip filter chain over a capture's sub-frames. @param {{ dur: number, grade?: string, flashIn?: number, fadeOut?: number }} c
 * @param {{ sub: number, zone?: string }} meta @param {[number, number]} size */
export function clipFilter(c, meta, [W, H]) {
  const sub = meta.sub;
  return [
    sub > 1 ? `tmix=frames=${sub}` : null,
    sub > 1 ? `select='not(mod(n\\,${sub}))'` : null,
    `setpts=N/(${FPS}*TB)`,
    // JPEG is full-range BT.601 4:2:0 at 4K; out is limited-range BT.709, and at 1080 the 4K chroma is full 4:4:4
    `scale=${W}:${H}:flags=lanczos+accurate_rnd+full_chroma_int:in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709`,
    GRADES[/** @type {keyof typeof GRADES} */ (c.grade ?? meta.zone ?? 'seat')] ?? GRADES.seat,
    c.flashIn ? `fade=t=in:st=0:d=${c.flashIn}:color=white` : null,
    c.fadeOut ? `fade=t=out:st=${(c.dur - c.fadeOut).toFixed(3)}:d=${c.fadeOut}:color=black` : null,
    'format=yuv444p',
  ].filter(Boolean).join(',');
}

/** What a captured clip's part was made from (null: a video, still or black part, made fresh each time): the frames folder
 * and its capture's meta.json time. A part is reused only when its .src matches (11-25: a re-capture into a new folder
 * reused the old capture's parts, and the master showed the old shots). @param {string} FR @param {any} c */
export function partSource(FR, c) {
  if (c.video || c.still || c.shot === 'black') return null;
  return `${FR}/${c.shot} ${String(statSync(`${FR}/${c.shot}/meta.json`).mtimeMs)}`;
}

/** @param {string[]} argv */
export function main(argv) {
  const [FR, EDL, TITLES, MIX, OUT] = argv;
  if (!OUT) { console.error('node scripts/trailer/edit.mjs <framesDir> <edl.json> <titlesDir> <mix.wav|-> <out.mp4>'); return 2; }
  const edl = JSON.parse(readFileSync(EDL, 'utf8'));
  /** @type {[number, number]} */
  const size = edl.size ?? [1920, 1080];
  const [W, H] = size;
  const TMP = `${OUT}.parts`;
  mkdirSync(TMP, { recursive: true });
  const ff = (/** @type {string[]} */ args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });

  /** @type {string[]} */
  const parts = [];
  edl.clips.forEach((/** @type {any} */ c, /** @type {number} */ k) => {
    const out = `${TMP}/${String(k).padStart(2, '0')}-${c.shot}.mkv`;
    parts.push(out);
    const frames = clipFrames(c);
    const src = partSource(FR, c);
    if (src !== null && existsSync(out) && !edl.rebuild && existsSync(`${out}.src`) && readFileSync(`${out}.src`, 'utf8') === src) return;
    if (c.shot === 'black') {
      ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}`, '-frames:v', String(frames), '-vf', 'format=yuv444p', '-c:v', 'libx264', '-qp', '4', '-pix_fmt', 'yuv444p', out]);
      return;
    }
    if (c.video) {
      ff(['-ss', String(c.in), '-i', c.video, '-frames:v', String(frames), '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv444p${c.flashIn ? `,fade=t=in:st=0:d=${c.flashIn}:color=white` : ''}`,
        '-an', '-c:v', 'libx264', '-qp', '4', '-pix_fmt', 'yuv444p', out]);
      console.log(`[edit] ${c.shot} (video) ${c.in}+${c.dur}s`);
      return;
    }
    if (c.still) {
      const file = c.still.startsWith('/') ? c.still : `${FR}/${c.shot}/${c.still}`;
      ff(['-loop', '1', '-framerate', String(FPS), '-i', file, '-frames:v', String(frames), '-vf', clipFilter(c, { sub: 1, zone: c.zone }, size),
        '-c:v', 'libx264', '-qp', '4', '-pix_fmt', 'yuv444p', out]);
      console.log(`[edit] ${c.shot} (still ${c.still}) ${c.dur}s`);
      return;
    }
    const dir = `${FR}/${c.shot}`;
    const meta = JSON.parse(readFileSync(`${dir}/meta.json`, 'utf8'));
    const start = Math.round(c.in * FPS) * meta.sub;
    const f = (/** @type {number} */ n) => `${dir}/${String(n).padStart(6, '0')}.jpg`;
    if (!existsSync(f(start)) || !existsSync(f(start + frames * meta.sub - 1))) throw new Error(`${c.shot}: sub-frames ${start}..${start + frames * meta.sub - 1} not captured`);
    // -frames:v is an OUTPUT limit (after -i): the clip's 60 fps frame count, not its sub-frames
    ff(['-framerate', String(FPS * meta.sub), '-start_number', String(start), '-i', `${dir}/%06d.jpg`, '-frames:v', String(frames),
      '-vf', clipFilter(c, meta, size), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-qp', '4', '-pix_fmt', 'yuv444p', out]);
    if (src !== null) writeFileSync(`${out}.src`, src);
    console.log(`[edit] ${c.shot} ${c.in}+${c.dur}s`);
  });

  writeFileSync(`${TMP}/list.txt`, parts.map((p) => `file '${p}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', `${TMP}/list.txt`, '-c', 'copy', `${TMP}/picture.mkv`]);

  // the finish (vignette + grain) sits under the type: the vignette would grey the titles, the grain would crawl on them
  const inputs = ['-i', `${TMP}/picture.mkv`];
  const chains = ['[0:v]vignette=angle=0.42:mode=forward,noise=c0s=3:c0f=t+u[pic]'];
  let last = '[pic]';
  const titles = edl.titles ?? [];
  titles.forEach((/** @type {any} */ t, /** @type {number} */ k) => {
    inputs.push('-framerate', String(FPS), '-i', `${TITLES}/${t.id}/%05d.png`);
    chains.push(`[${k + 1}:v]format=rgba,setpts=PTS-STARTPTS+${t.at}/TB[t${k}]`);
    chains.push(`${last}[t${k}]overlay=eof_action=pass:format=yuv444[v${k}]`);
    last = `[v${k}]`;
  });
  // edl.overlays [{ png, from, to }]: a still over a span (the ALPHA 2 · IN ENGINE corner bug on every gameplay frame)
  const overlays = edl.overlays ?? [];
  overlays.forEach((/** @type {any} */ o, /** @type {number} */ k) => {
    inputs.push('-loop', '1', '-framerate', String(FPS), '-i', o.png);
    chains.push(`[${titles.length + k + 1}:v]format=rgba[o${k}]`);
    chains.push(`${last}[o${k}]overlay=shortest=1:format=yuv444:enable='between(t,${o.from},${o.to})'[w${k}]`);
    last = `[w${k}]`;
  });
  chains.push(`${last}format=yuv420p[vout]`);
  const audio = MIX && MIX !== '-' ? ['-i', MIX] : [];
  const aIdx = titles.length + overlays.length + 1;
  ff([...inputs, ...audio, '-filter_complex', chains.join(';'), '-map', '[vout]', ...(audio.length > 0 ? ['-map', `${aIdx}:a`] : []),
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level', '4.2', '-crf', '14', '-maxrate', '40M', '-bufsize', '80M',
    '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-r', String(FPS), '-g', '30',
    ...(audio.length > 0 ? ['-c:a', 'aac', '-b:a', '320k', '-ar', '48000'] : []), '-t', String(edl.length), '-movflags', '+faststart', OUT]);
  console.log(`[edit] wrote ${OUT}`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
