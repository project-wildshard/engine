// A build beat (docs/trailer.md): a real Claude Code session, replayed as a terminal, beside the zone it changed. Restored
// from singleplayer scripts/steam-trailer/build-beat.mjs (cf104912d3^), with the panels as arguments. Nothing is staged:
// the terminal is the recording (an asciicast, sped up to fit), the panels are real captures (a commit time-lapse, the
// zone before and after).
//
//   node scripts/trailer/build-beat.mjs <session.cast> <out.mp4> --dur <s> --lapse <a.mp4> [--lapse <b.mp4>] [--crop-top <px>]
//        [--from <s>] [--to <s>] [--hold <s>] [--layout side|stack]
//
// --from / --to cut the session to that span (its seconds, before the speed-up); everything after a typed /exit is cut.
// Layout (1920×1080 on the site's abyss), a cyan hairline framing each part:
//   side   the terminal on the left (agg, the asciinema renderer, scaled to fit 960 px), one panel on the right at 800 px or
//          two stacked. The bottom left stays clear for a caption.
//   stack  read on a phone: the panel large on top (1216 × 684), the terminal as a strip under it across the frame, its
//          few rows (transcript-cast.mjs --compact --rows 4) at about 46 px type.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export const FPS = 60;
/** An asciicast's events and length in seconds, cut at a typed /exit and to [from, to] (v2 times are absolute, v3 intervals).
 * @param {string} text @param {{ from?: number, to?: number }} [span] */
export function castSpan(text, span = {}) {
  const lines = text.trim().split('\n');
  const header = JSON.parse(lines[0]);
  /** @type {[number, string, string][]} */
  let all = lines.slice(1).map((l) => JSON.parse(l));
  if (header.version === 3) { let t = 0; all = all.map(([dt, k, d]) => { t += dt; return [t, k, d]; }); }
  const exitAt = all.findIndex((e) => typeof e[2] === 'string' && e[2].includes('/exit'));
  if (exitAt > 0) all = all.slice(0, exitAt);
  const from = span.from ?? 0, to = span.to ?? Infinity;
  const kept = all.filter((e) => e[0] >= from && e[0] <= to).map(([t, k, d]) => /** @type {[number, string, string]} */ ([Number((t - from).toFixed(6)), k, d]));
  // the screen before `from` still matters: replay it at time 0
  const before = all.filter((e) => e[0] < from && e[1] === 'o').map((e) => e[2]).join('');
  const events = before ? [/** @type {[number, string, string]} */ ([0, 'o', before]), ...kept] : kept;
  return { header: { ...header, version: 2 }, events, length: events.length > 0 ? events[events.length - 1][0] : 0 };
}

/** @param {string[]} argv */
export function main(argv) {
  const [CAST, OUT] = argv;
  const opt = (/** @type {string} */ k, /** @type {string} */ d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };
  const all = (/** @type {string} */ k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
  if (!OUT) { console.error('node scripts/trailer/build-beat.mjs <session.cast> <out.mp4> --dur <s> --lapse <mp4> [--lapse <mp4>]'); return 2; }
  const DUR = Number(opt('dur', '8')), HOLD = Number(opt('hold', '1')), CROP = Number(opt('crop-top', '0'));
  const LAPSES = all('lapse'), STACK = opt('layout', 'side') === 'stack';
  const TMP = `${OUT}.parts`;
  mkdirSync(TMP, { recursive: true });
  const ff = (/** @type {string[]} */ args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });

  const { header, events, length } = castSpan(readFileSync(CAST, 'utf8'), { from: opt('from', '') ? Number(opt('from', '0')) : undefined, to: opt('to', '') ? Number(opt('to', '0')) : undefined });
  writeFileSync(`${TMP}/session.cast`, `${[JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join('\n')}\n`);
  const speed = Math.max(1, length / (DUR - HOLD));
  console.log(`[build-beat] session ${length.toFixed(0)} s → ${(DUR - HOLD).toFixed(2)} s (${speed.toFixed(0)}×)`);
  execFileSync('agg', ['--speed', String(speed), '--fps-cap', '30', '--font-size', STACK ? '34' : '22', '--idle-time-limit', '100000', '--last-frame-duration', '0', `${TMP}/session.cast`, `${TMP}/term.gif`], { stdio: 'inherit' });
  ff(['-i', `${TMP}/term.gif`, '-vf', `fps=${FPS},scale=${STACK ? '1800:296' : '960:900'}:force_original_aspect_ratio=decrease:flags=lanczos,tpad=stop_mode=clone:stop_duration=${DUR},trim=duration=${DUR},format=yuv444p`,
    '-c:v', 'libx264', '-qp', '6', '-pix_fmt', 'yuv444p', `${TMP}/term.mkv`]);

  const two = LAPSES.length > 1, pw = STACK ? 1216 : two ? 800 : 820;
  LAPSES.slice(0, 2).forEach((f, k) => {
    const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
    ff(['-i', f, '-vf', `${CROP > 0 ? `crop=iw:ih-${CROP}:0:${CROP},` : ''}setpts=PTS*${(DUR / d).toFixed(5)},fps=${FPS},scale=${pw}:-2:flags=lanczos,trim=duration=${DUR},format=yuv444p`,
      '-an', '-c:v', 'libx264', '-qp', '6', '-pix_fmt', 'yuv444p', `${TMP}/lapse-${k}.mkv`]);
  });
  const frame = (/** @type {number} */ i) => `[${i}:v]pad=iw+4:ih+4:2:2:color=0x8fe3ff@0.55[f${i}]`;
  const ins = ['-f', 'lavfi', '-i', `color=c=0x050a12:s=1920x1080:r=${FPS}:d=${DUR}`, '-i', `${TMP}/term.mkv`, ...LAPSES.slice(0, 2).flatMap((_, k) => ['-i', `${TMP}/lapse-${k}.mkv`])];
  const graph = [frame(1), STACK ? '[0:v][f1]overlay=(W-w)/2:H-h-36:shortest=1[a]' : '[0:v][f1]overlay=56:56:shortest=1[a]'];
  if (STACK && LAPSES.length > 0) graph.push(frame(2), '[a][f2]overlay=(W-w)/2:36:shortest=1,format=yuv420p[v]');
  else if (LAPSES.length === 1) graph.push(frame(2), '[a][f2]overlay=1050:(H-h)/2:shortest=1,format=yuv420p[v]');
  else if (two) graph.push(frame(2), frame(3), '[a][f2]overlay=1066:60:shortest=1[b]', '[b][f3]overlay=1066:H-h-60:shortest=1,format=yuv420p[v]');
  else graph.push('[a]format=yuv420p[v]');
  ff([...ins, '-filter_complex', graph.join(';'), '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-crf', '12', '-preset', 'slow', '-pix_fmt', 'yuv420p', OUT]);
  console.log(`[build-beat] wrote ${OUT}`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
