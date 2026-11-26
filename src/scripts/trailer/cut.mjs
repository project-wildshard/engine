// The cut: one table for picture, titles and sound, timed to the score; one data file per trailer in cuts/ (docs/trailer.md).
// Restored from singleplayer scripts/steam-trailer/cut.mjs (cf104912d3^).
//   node src/scripts/trailer/cut.mjs <outDir> <musicTake> <sfxDir> --cut <name> | --cut-file=<path> [--<key> <value>]...
//     → <outDir>/edl.json, titles.json, mix.json
//
// cuts/<name>.mjs exports cut({ TAKE, SFX, portrait, ...opts }) → { edl: { length, clips, titles, overlays?, size? }, titles,
// mix, report? }; every other --<key> <value> reaches it as opts[key] (the alpha 2 cut: --bug <png>, --build-1 <mp4> …):
//   test      a two-clip smoke cut of held dry stills (meta ALPHA-2-TRAILER AT2)
//   alpha-2   the alpha 2 trailer (meta ALPHA-2-TRAILER AT10)
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The cut's own options from argv[3..]: every --<key> <value> (or --<key>=<value>, or a bare --<key> = true) but --cut,
 * --cut-file and --portrait. @param {string[]} argv */
export function cutOptions(argv) {
  /** @type {Record<string, string | true>} */
  const extra = {};
  for (let i = 3; i < argv.length; i++) {
    const m = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/u.exec(argv[i]);
    if (!m) continue;
    const value = m[2] ?? (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    if (!['cut', 'cut-file', 'portrait'].includes(m[1])) extra[m[1]] = value;
  }
  return extra;
}

/** @param {string[]} argv */
export async function main(argv) {
  const [OUT, TAKE, SFX] = argv;
  if (!SFX) { console.error('node src/scripts/trailer/cut.mjs <outDir> <musicTake> <sfxDir> --cut <name> [--<key> <value>]...'); return 2; }
  const opts = cutOptions(argv);
  const named = argv.indexOf('--cut'), fileArg = argv.find((a) => a.startsWith('--cut-file='));
  mkdirSync(OUT, { recursive: true });
  const { cut } = await import(fileArg ? pathToFileURL(resolve(fileArg.slice('--cut-file='.length))).href : `./cuts/${named === -1 ? 'alpha-2' : argv[named + 1]}.mjs`);
  const { edl, titles, mix, report } = cut({ TAKE: resolve(TAKE), SFX: resolve(SFX), portrait: argv.includes('--portrait'), ...opts });
  writeFileSync(`${OUT}/edl.json`, JSON.stringify(edl, null, 1));
  writeFileSync(`${OUT}/titles.json`, JSON.stringify(titles, null, 1));
  writeFileSync(`${OUT}/mix.json`, JSON.stringify(mix, null, 1));
  console.log(edl.clips.map((/** @type {any} */ c) => `${c.at.toFixed(2).padStart(6)}  ${c.shot.padEnd(14)} in ${c.in}  ${c.dur.toFixed(2)} s`).join('\n'));
  if (report) console.log(report);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
