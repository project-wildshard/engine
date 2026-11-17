// Meta STAGING-SMOKE SM7: a board only on change. A run with no findings and every vision verdict `same` or `baseline` is one
// receipt line; anything else writes <out>/board.html (findings first, worst first, each with its keyframes beside the last
// release's, the clip and its severity and SB row; the clean scenarios as one line), which the caller publishes as an
// artifact (with its img/ and clips/ beside it), lists in meta JAKE-READ-LIST.md and opens in Chrome (the only link it opens).
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** @typedef {import('./checks.mjs').Finding & { sheet?: string }} BoardFinding */
/** @typedef {{ scenario: string, verdict: string, severity?: string, line: string, bullet?: string, sheet?: string }} BoardVision */
/**
 * @typedef {{ release: string, build?: string, url?: string, at?: string, seconds: number, last?: string, hold: boolean,
 *   scenarios: { id: string, title: string, status: string, reason?: string, seconds: number, timeToPlay?: number, frames: Record<string, string>, video?: string }[],
 *   findings: BoardFinding[], vision?: BoardVision[], bugbash?: { added: string[], seenAgain: string[], rowOf?: Record<string, string> } }} BoardVerdict
 */

/** True when nothing changed: no findings and every vision verdict same or baseline. @param {BoardVerdict} v */
export function isClean(v) {
  return v.findings.length === 0 && (v.vision ?? []).every((x) => x.verdict === 'same' || x.verdict === 'baseline');
}

/** The one receipt line of a clean run. @param {BoardVerdict} v @param {Date} [now] */
export function receiptLine(v, now = new Date()) {
  const ran = v.scenarios.filter((s) => s.status !== 'skip').length, skipped = v.scenarios.length - ran;
  const looks = new Set((v.vision ?? []).map((x) => x.verdict));
  const vision = looks.size === 0 ? 'none' : looks.has('baseline') && looks.size === 1 ? 'baseline' : looks.has('baseline') ? 'same, some baseline' : 'same';
  const hhmm = now.toISOString().slice(11, 16);
  return `${hhmm} UTC staging-smoke DONE ${v.release} ${(v.build ?? '').slice(0, 8)} ${String(ran)}/${String(v.scenarios.length)} clean${skipped > 0 ? ` (${String(skipped)} skip)` : ''}, vision ${vision}, ${String(Math.round(v.seconds))} s`;
}

/** @param {string} s */
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** @param {string} cls @param {string} text */
const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;

/**
 * Write <out>/board.html (and its clips under <out>/clips/) for a run that found something; returns the file.
 * @param {BoardVerdict} v @param {{ out: string, lastDir?: string }} o
 */
export function writeBoard(v, { out, lastDir }) {
  mkdirSync(join(out, 'clips'), { recursive: true });
  mkdirSync(join(out, 'img'), { recursive: true });
  let shot = 0;
  /** Copy an image next to the board; its relative path, or undefined when the file is missing. @param {string | undefined} path */
  const image = (path) => {
    if (path === undefined || !existsSync(path)) return undefined;
    const name = `img/${String(shot++).padStart(2, '0')}-${basename(path)}`;
    copyFileSync(path, join(out, name));
    return name;
  };
  /** @type {Record<string, string>} */
  const clips = {};
  for (const s of v.scenarios) {
    if (s.video !== undefined && existsSync(s.video)) { const name = `${s.id}${s.video.endsWith('.webm') ? '.webm' : '.mp4'}`; copyFileSync(s.video, join(out, 'clips', name)); clips[s.id] = `clips/${name}`; }
  }
  const sb = new Map(v.findings.map((f) => [f, v.bugbash?.rowOf?.[`${f.scenario}/${f.key}`]]));
  const findings = v.findings.map((f) => {
    const s = v.scenarios.find((x) => x.id === f.scenario);
    const frame = f.sheet ?? f.frame;
    const name = frame === undefined ? undefined : basename(frame, '.jpg');
    const before = f.sheet === undefined && lastDir !== undefined && name !== undefined ? join(lastDir, f.scenario, 'frames', `${name}.jpg`) : undefined;
    const then = image(before), now = image(frame);
    const shots = f.sheet !== undefined
      ? (now === undefined ? '' : `<figure class="sheet"><img src="${now}" alt="${esc(`${f.scenario} contact sheet: ${v.last ?? 'last release'} over ${v.release}`)}"><figcaption>Top: ${esc(v.last ?? 'last release')}. Bottom: ${esc(v.release)}. Title, Shard Select, loading, play +1 s, play +10 s, last frame.</figcaption></figure>`)
      : `<div class="pair">${then === undefined ? `<figure class="missing"><div>no ${esc(v.last ?? 'earlier')} frame</div><figcaption>${esc(v.last ?? 'last release')}</figcaption></figure>` : `<figure><img src="${then}" alt="${esc(`${f.scenario} ${name ?? ''} on ${v.last ?? 'the last release'}`)}"><figcaption>${esc(v.last ?? 'last release')} · ${esc(name ?? '')}</figcaption></figure>`}${now === undefined ? '' : `<figure><img src="${now}" alt="${esc(`${f.scenario} ${name ?? ''} on ${v.release}`)}"><figcaption>${esc(v.release)} · ${esc(name ?? '')}</figcaption></figure>`}</div>`;
    const clip = clips[f.scenario];
    return `<article class="finding sev-${f.severity}">
  <header>${pill(`sev ${f.severity}`, f.severity)}<b>${esc(f.scenario)}</b><span class="muted">${esc(s?.title ?? '')}</span>${sb.get(f) === undefined ? '' : pill('sb', String(sb.get(f)))}<code>${esc(f.key)}</code></header>
  <p>${esc(f.text)}</p>
  ${shots}
  ${clip === undefined ? '' : `<video src="${clip}" controls muted playsinline preload="metadata"></video>`}
</article>`;
  }).join('\n');
  const flagged = new Set(v.findings.map((f) => f.scenario));
  const clean = v.scenarios.filter((s) => !flagged.has(s.id));
  const cleanLine = clean.length === 0 ? '' : `<p class="clean"><b>Clean:</b> ${clean.map((s) => `${esc(s.id)} ${esc(s.title)}${s.status === 'skip' ? ' (skip)' : s.timeToPlay === undefined ? '' : ` · play in ${(s.timeToPlay / 1000).toFixed(1)} s`}`).join(' · ')}</p>`;
  const vision = (v.vision ?? []).map((x) => `<tr><td>${esc(x.scenario)}</td><td>${pill(`v-${x.verdict}`, x.verdict)}${x.severity === undefined ? '' : ` ${pill(`sev ${x.severity}`, x.severity)}`}</td><td>${esc(x.line)}${x.bullet === undefined ? '' : ` <span class="muted">(${esc(x.bullet)})</span>`}</td></tr>`).join('');
  const worst = v.findings[0]?.severity ?? 'none';
  const html = `<title>Staging Smoke ${esc(v.release)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
/* Layout: a QA log; a fact strip, then findings worst first, each a pair of phone frames, then the vision table. */
:root { --bg: #f3f5f4; --panel: #ffffff; --fg: #18201d; --muted: #5b6863; --line: #d5dcd9; --accent: #1f6f5c;
  --p0: #b42318; --p1: #b54708; --p2: #4f5d75; --ok: #1f6f5c;
  --sans: "IBM Plex Sans", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #101513; --panel: #18201d; --fg: #e4ebe8; --muted: #93a29c; --line: #2b3632; --accent: #5cc4a6; --p0: #f97066; --p1: #fdb022; --p2: #a4b4cf; --ok: #5cc4a6; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #101513; --panel: #18201d; --fg: #e4ebe8; --muted: #93a29c; --line: #2b3632; --accent: #5cc4a6; --p0: #f97066; --p1: #fdb022; --p2: #a4b4cf; --ok: #5cc4a6; color-scheme: dark; }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 var(--sans); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 24px 48px; }
main { max-width: 980px; margin: 0 auto; display: grid; gap: 20px; }
h1 { font: 600 1.6rem/1.2 var(--mono); margin: 0; text-wrap: balance; }
h2 { font: 600 .8rem var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 8px 0 0; }
.facts { display: flex; flex-wrap: wrap; gap: 8px 20px; font: .85rem var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.facts b { color: var(--fg); font-weight: 600; }
.pill { display: inline-block; font: 600 .72rem var(--mono); letter-spacing: .05em; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
.sev.P0 { color: var(--p0); } .sev.P1 { color: var(--p1); } .sev.P2 { color: var(--p2); } .sb { color: var(--accent); }
.hold { color: var(--p0); } .go { color: var(--ok); }
.v-same, .v-baseline { color: var(--ok); } .v-changed { color: var(--accent); } .v-regressed, .v-error { color: var(--p1); }
.finding { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--p2); border-radius: 6px; padding: 14px 16px; display: grid; gap: 10px; min-width: 0; }
.finding.sev-P0 { border-left-color: var(--p0); } .finding.sev-P1 { border-left-color: var(--p1); }
.finding header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.finding p { margin: 0; max-width: 70ch; }
.muted { color: var(--muted); }
code { font: .8rem var(--mono); color: var(--muted); }
.pair { display: flex; flex-wrap: wrap; gap: 12px; }
figure { margin: 0; display: grid; gap: 4px; width: min(220px, 45%); }
figure img { width: 100%; border-radius: 4px; border: 1px solid var(--line); }
figure.sheet { width: 100%; }
figure.missing div { aspect-ratio: 402 / 874; max-width: 100%; display: grid; place-items: center; border: 1px dashed var(--line); border-radius: 4px; color: var(--muted); font: .8rem var(--mono); }
figcaption { font: .75rem var(--mono); color: var(--muted); }
video { width: min(260px, 100%); border-radius: 4px; background: #000; }
.clean { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; margin: 0; }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
td { border-top: 1px solid var(--line); padding: 6px 8px; vertical-align: top; }
td:first-child { font-family: var(--mono); }
</style>
<main>
  <h1>Staging Smoke ${esc(v.release)}</h1>
  <div class="facts">
    <span>${v.hold ? pill('hold', 'HOLDS PROD') : pill('go', 'PROD MAY GO')}</span>
    <span>build <b>${esc((v.build ?? '?').slice(0, 8))}</b></span>
    <span>worst <b>${esc(worst)}</b></span>
    <span><b>${String(v.findings.length)}</b> findings</span>
    <span>compared with <b>${esc(v.last ?? 'nothing (baseline)')}</b></span>
    <span><b>${String(Math.round(v.seconds))}</b> s run</span>
    <span>${esc(v.url ?? '')}</span>
    <span>${esc(v.at ?? '')}</span>
  </div>
  <h2>Findings, worst first</h2>
  ${findings}
  ${cleanLine}
  <h2>Vision pass (Opus, last release over this one)</h2>
  <div class="table"><table>${vision || '<tr><td colspan="3">No vision pass ran.</td></tr>'}</table></div>
  <p class="muted">P0 blocks play, P1 looks broken, P2 is polish. A P0 or P1 holds production go-live (J398); every finding is a STAGING-BUGBASH row.</p>
</main>
`;
  const file = join(out, 'board.html');
  writeFileSync(file, html);
  return file;
}
