#!/usr/bin/env node
// GRID-CROSSING GC3: one report for every pair. Reads the in-page tours (`grid-crossing-tour.mjs`, `*-tour.json`, every pair both ways
// on preview or a loopback page) and the online walks (`grid-crossing-qa.mjs`'s `rows.json` on staging: the pairs a walker can reach by
// input), writes report.html (pairs × the goal's measures, worst first, and thumbnails of the failed or walled crossings in shots/) and checks every
// crossing against the ratchet `test/grid-crossing-ratchet.json`: a pair worse than its ratchet makes the run exit 1.
//   node scripts/grid-crossing-report.mjs <out dir> --runs=<tour dir or rows.json>,… [--tighten]
//   --tighten writes the ratchet after the run (new pairs join, numbers only go down); without it the ratchet is read only.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve as absolute } from 'node:path';
import sharp from 'sharp';
import { pairKey, tighten, worse } from './grid-crossing-ratchet.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = absolute(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? '');
const sources = flag('runs', '').split(',').filter(Boolean).map(path => absolute(path));
if (out === absolute('') || sources.length === 0) throw new Error('usage: grid-crossing-report.mjs <out dir> --runs=<tour dir or rows.json>,… [--tighten]');
const RATCHET = join(import.meta.dirname, '../test/grid-crossing-ratchet.json');

/** @typedef {{ site: string, run: string, from: string, to: string, boost: boolean, repeat: boolean, ok: boolean, why: string, borderToControlMs: number | null, freezeMs: number | null, wallMs: number | null, over50: number | null, over33: number | null, build: string, shot: string | null }} Row */
/** @type {Row[]} */
const rows = [];
const siteOf = (/** @type {string} */ base) => base.includes('staging') ? 'staging' : base.includes('preview') ? 'preview' : 'local';
for (const source of sources) {
  const files = statSync(source).isDirectory() ? readdirSync(source).filter(name => name.endsWith('-tour.json')).map(name => join(source, name)) : [source];
  for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(data)) {
      // grid-crossing-qa rows: the walk proof's legs online
      for (const run of data) for (const leg of run.legs ?? []) {
        if (typeof leg.from !== 'string' || typeof leg.target !== 'string') continue;
        rows.push({ site: siteOf(run.base), run: run.run, from: leg.from, to: leg.target, boost: leg.boost === true, repeat: false, ok: typeof leg.controlAtMs === 'number' && leg.controlAtMs > 0,
          why: '', borderToControlMs: leg.borderToControlMs ?? null, freezeMs: leg.worstStopMs ?? null, wallMs: null, over50: leg.over50 ?? null, over33: null, build: '', shot: null });
      }
      continue;
    }
    const run = `${String(data.engine)}-${String(data.layout).startsWith('phone') ? 'phone' : 'desktop'}`;
    for (const c of data.crossings ?? []) {
      const shot = join(dirname(file), `${String(data.engine)}-${String(c.from)}-${String(c.to)}.png`);
      rows.push({ site: siteOf(data.base), run, from: c.from, to: c.to, boost: c.boost, repeat: c.repeat, ok: c.ok, why: c.why ?? '', borderToControlMs: c.borderToControlMs ?? null,
        freezeMs: c.freezeMs ?? null, wallMs: c.wallMs ?? null, over50: c.over50 ?? null, over33: c.over33 ?? null, build: data.build ?? '', shot: existsSync(shot) ? shot : null });
    }
  }
}
// a pair's first crossing in a run is its score; a repeat stands in only for an arc the run never scored
/** @type {Map<string, Row>} */
const scored = new Map();
for (const row of rows) { const key = pairKey(row.site, row.run, row.from, row.to), had = scored.get(key); if (had === undefined || (had.repeat && !row.repeat)) scored.set(key, row); }
const now = Object.fromEntries([...scored].map(([key, row]) => [key, { ok: row.ok, borderToControlMs: row.borderToControlMs, freezeMs: row.freezeMs, wallMs: row.wallMs, over50: row.over50 }]));
const ratchet = existsSync(RATCHET) ? JSON.parse(readFileSync(RATCHET, 'utf8')) : {};
const worsened = worse(ratchet, now);
if (process.argv.includes('--tighten')) writeFileSync(RATCHET, `${JSON.stringify(tighten(ratchet, now), null, 2)}\n`);

// the goal table's bars (meta GRID-CROSSING-PLAN "The goal"): no stop, no wall, no frame over 50 ms on desktop (1 on the phone)
// a stop is read from samples 100 ms apart, so one sample (100 ms) is the floor of the reading, not a stop

const meets = (/** @type {Row} */ row) => row.ok && (row.freezeMs ?? 0) <= 100 && (row.wallMs ?? 0) === 0 && (row.over50 ?? 0) <= (row.run.endsWith('phone') ? 1 : 0);
const badness = (/** @type {Row} */ row) => (row.ok ? 0 : 1e9) + (row.wallMs ?? 0) * 10 + (row.freezeMs ?? 0) + (row.over50 ?? 0) * 50 + (row.borderToControlMs ?? 0) / 100;
const pairs = [...new Set([...scored.values()].map(row => `${row.from}:${row.to}`))];
const runs = [...new Set([...scored.values()].map(row => `${row.site}/${row.run}`))].sort();
const cellOf = (/** @type {string} */ pair, /** @type {string} */ run) => scored.get(`${run}/${pair}`);
pairs.sort((a, b) => Math.max(...runs.map(run => { const r = cellOf(b, run); return r === undefined ? -1 : badness(r); })) - Math.max(...runs.map(run => { const r = cellOf(a, run); return r === undefined ? -1 : badness(r); })));

const esc = (/** @type {unknown} */ text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const ms = (/** @type {number | null} */ value) => value === null ? '–' : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${String(value)} ms`;
const short = (/** @type {string} */ instance) => instance.replace(/^open-plot-/u, 'plot ');
/** @type {Map<string, string>} */
const thumbs = new Map();
// thumbnails beside the report (`shots/`), published with it as the artifact's own files
mkdirSync(join(out, 'shots'), { recursive: true });
for (const row of scored.values()) if (row.shot !== null && thumbs.size < 60) {
  const name = `shots/${row.run}-${basename(row.shot, '.png')}.jpg`;
  await sharp(row.shot).resize({ width: 360 }).jpeg({ quality: 62 }).toFile(join(out, name));
  thumbs.set(row.shot, name);
}
const cell = (/** @type {Row | undefined} */ row) => {
  if (row === undefined) return '<td class="none">not run</td>';
  const state = !row.ok ? 'fail' : meets(row) ? 'meets' : 'passes';
  const bits = row.ok ? `<b>${ms(row.borderToControlMs)}</b><span>stop ${ms(row.freezeMs)} · wall ${ms(row.wallMs)} · &gt;50 ms ${row.over50 === null ? '–' : String(row.over50)}</span>` : `<b>no control</b><span>${esc(row.why)}</span>`;
  return `<td class="${state}">${bits}${row.boost ? '<i>boost</i>' : '<i>walk</i>'}${row.repeat ? '<i>repeat</i>' : ''}</td>`;
};
const all = [...scored.values()], failed = all.filter(row => !row.ok), walled = all.filter(row => row.ok && (row.wallMs ?? 0) > 0), meeting = all.filter(meets);
const builds = [...new Set(all.map(row => row.build).filter(Boolean))].join(', ');
const html = `<title>Grid Crossing Pairs</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* layout: one summary band, then a wide pair table that scrolls inside itself, then the shots of what failed */
:root { --bg: #f3f5f7; --panel: #ffffff; --fg: #18202a; --muted: #5b6876; --line: #d5dce3; --accent: #1f6fb2; --meets: #1d7a46; --meets-bg: #e3f3ea; --passes: #8a6100; --passes-bg: #fbf1d9; --fail: #b3261e; --fail-bg: #fbe4e2;
  --head: 'Space Grotesk', system-ui, sans-serif; --body: 'Inter', system-ui, sans-serif; --mono: 'JetBrains Mono', ui-monospace, monospace }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #10151b; --panel: #171e26; --fg: #e4e9ee; --muted: #93a1af; --line: #2a3541; --accent: #6cb2ec; --meets: #6fd39b; --meets-bg: #15301f; --passes: #e6bd5c; --passes-bg: #33290f; --fail: #f08a82; --fail-bg: #3a1714; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #10151b; --panel: #171e26; --fg: #e4e9ee; --muted: #93a1af; --line: #2a3541; --accent: #6cb2ec; --meets: #6fd39b; --meets-bg: #15301f; --passes: #e6bd5c; --passes-bg: #33290f; --fail: #f08a82; --fail-bg: #3a1714; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font-family: var(--body); padding-block: 24px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)) }
main { display: grid; gap: 24px; max-width: 1400px; margin: 0 auto }
h1, h2 { font-family: var(--head); text-wrap: balance; margin: 0 } h1 { font-size: 1.9rem } h2 { font-size: 1.25rem }
p { max-width: 70ch; line-height: 1.5; margin: 0; color: var(--muted) } code { font-family: var(--mono); font-size: .85em }
.sum { display: flex; flex-wrap: wrap; gap: 12px } .sum div { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; min-width: 0 }
.sum b { display: block; font: 600 1.5rem var(--head); font-variant-numeric: tabular-nums } .sum span { color: var(--muted); font-size: .8rem; letter-spacing: .04em; text-transform: uppercase }
.wide { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 6px }
table { border-collapse: collapse; font-size: .8rem; font-variant-numeric: tabular-nums } th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top }
th { font-family: var(--head); position: sticky; top: 0; background: var(--panel); white-space: nowrap } th.pair { white-space: nowrap }
td b { display: block; font-weight: 600 } td span { display: block; color: var(--muted); max-width: 26ch } td i { font-style: normal; font-size: .7rem; color: var(--muted); margin-right: 6px; text-transform: uppercase; letter-spacing: .05em }
td.meets { background: var(--meets-bg) } td.meets b { color: var(--meets) } td.passes { background: var(--passes-bg) } td.passes b { color: var(--passes) } td.fail { background: var(--fail-bg) } td.fail b { color: var(--fail) } td.none { color: var(--muted) }
.worse { border-left: 3px solid var(--fail); padding-left: 10px } .worse li { font-family: var(--mono); font-size: .8rem }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px } figure { margin: 0; min-width: 0 } figure img { width: 100%; border-radius: 4px; border: 1px solid var(--line) } figcaption { font-size: .75rem; color: var(--muted); padding-top: 4px }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono&family=Space+Grotesk:wght@600&display=swap">
<main>
<header style="display:grid;gap:8px"><h1>Grid crossing, every pair</h1>
<p>Each cell is one crossing by real input from 12 m inside a cell's edge to control in its neighbour: <b>border to control</b>, the longest stop (under 0.1 m per 100 ms with the key held), the time held at an unready neighbour's wall, and frames over 50 ms within 3 s of the border. Green meets the plan's goal bars, amber reaches control but misses a bar, red never got control. Built ${esc(builds || 'unknown')}, ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC.</p></header>
<section class="sum"><div><b>${String(pairs.length)}</b><span>pairs (directed)</span></div><div><b>${String(all.length)}</b><span>crossings scored</span></div><div><b>${String(meeting.length)}</b><span>meet every bar</span></div><div><b>${String(walled.length)}</b><span>held at a wall</span></div><div><b>${String(failed.length)}</b><span>no control</span></div><div><b>${String(worsened.length)}</b><span>worse than ratchet</span></div></section>
${worsened.length === 0 ? '' : `<section class="worse"><h2>Worse than the ratchet</h2><ul>${worsened.map(row => `<li>${esc(row.key)} ${esc(row.measure)}: ${esc(row.held)} → ${esc(row.now)}</li>`).join('')}</ul></section>`}
<section style="display:grid;gap:8px"><h2>Pairs, worst first</h2><div class="wide"><table><thead><tr><th class="pair">From → to</th>${runs.map(run => `<th>${esc(run)}</th>`).join('')}</tr></thead><tbody>
${pairs.map(pair => { const [from = '', to = ''] = pair.split(':'); return `<tr><th class="pair">${esc(short(from))} → ${esc(short(to))}</th>${runs.map(run => cell(cellOf(pair, run))).join('')}</tr>`; }).join('\n')}
</tbody></table></div></section>
${thumbs.size === 0 ? '' : `<section style="display:grid;gap:8px"><h2>Failed or walled crossings</h2><div class="shots">${[...scored.values()].filter(row => row.shot !== null && thumbs.has(row.shot)).map(row => `<figure><img alt="${esc(row.from)} to ${esc(row.to)}" src="${thumbs.get(/** @type {string} */ (row.shot)) ?? ''}"><figcaption>${esc(row.run)}: ${esc(short(row.from))} → ${esc(short(row.to))}, ${row.ok ? `wall ${ms(row.wallMs)}` : esc(row.why)}</figcaption></figure>`).join('')}</div></section>`}
<p>Not measured yet: grey stand-ins within 60 m of the player. Online pairs are only those a walker reaches by input (an online page can't place its seat); the in-page tour covers every pair. Sources: ${sources.map(source => `<code>${esc(basename(source))}</code>`).join(', ')}.</p>
</main>
`;
writeFileSync(join(out, 'report.html'), html);
for (const row of worsened) console.log(`WORSE ${row.key} ${row.measure}: ${String(row.held)} -> ${String(row.now)}`);
console.log(`grid-crossing report: ${String(all.length)} crossings, ${String(meeting.length)} meet the bars, ${String(failed.length)} without control, ${String(worsened.length)} worse than the ratchet; ${join(out, 'report.html')}`);
process.exit(worsened.length === 0 ? 0 : 1);
