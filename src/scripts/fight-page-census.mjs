#!/usr/bin/env node
// EG-15 (meta docs/plans/test-coverage/ENGINE.md, TEST-COVERAGE row 32): fight-page-census. What a server says, a page draws.
// It runs `worker-client-fights` journeys on four full heads (Nalati, Pine, Far Reach, Dunes) and holds, per head:
//   heard   every view word the server said to a page (`__workerClient().heard`, counted at the wire);
//   drawn   what the page drew of them (`__workerClient().drawn`, counted where a view applies a word);
//   offstage words for a view the page hasn't built, a room nobody entered (`__workerClient().offstage`): not drawn, and not dark;
//   bodies  every fight the page shows a bar for has a body drawn (`__workerClientFights().shown`, or an open arena's own body): BUG-28;
//   audio   every directed cue and score change that asked for a sound, and whether one played (`window.__audioTally`): N1, N2.
// A word heard that the page never drew is dark, unless WORDS below says why it draws nothing. A dark word, a bar with no body, a cue that
// found no sound or a step that failed is red. Digests and verb tapes can't see any of these: they never run a page.
//   src/scripts/browser-lane.sh node src/scripts/fight-page-census.mjs --base=http://127.0.0.1:4401/ [--heads=nalati,pine,far,dunes] [--journeys=titan] [--out=tmp/census/census.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, devices } from "./browser-playwright.mjs";
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';
import { fights, pageCensus } from './worker-client-fights.mjs';

const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = arg('base', ''), out = arg('out', 'tmp/census/census.json');
if (base === '') throw new Error('Requires --base');

/** Each head and the journeys that fight on it (`fights(…, only)`). Flags the journeys read off argv go on with them. `qara` is left
 *  out: its captain comes only after a night patrol is thinned, and some runs it never comes (`sweep`'s Argymaq draws an elite lane). */
export const HEADS = {
  nalati: { slug: 'nalati-grasslands', journeys: ['titan', 'sweep'], flags: ['--titanlook'] },
  pine: { slug: 'pine-hollow', journeys: ['rig', 'pine'], flags: [] },
  far: { slug: 'far-reach', journeys: ['roc', 'farreach'], flags: [] },
  dunes: { slug: 'sunscar-dunes', journeys: ['sunscar'], flags: [] },
};
/** View words a page hears and rightly draws nothing for, and why. Everything else heard must be drawn. */
export const WORDS = [
  // Exact words, not a prefix: a lane-sheet boss's strike must still be drawn (clientBossTelegraph.ts).
  ['boss.strike.far.roc.stoop', 'the Roc\'s presentation is marked and names no strike: no page view takes it, its body plays the attack off its row'],
  ['boss.strike.sunscar.matriarch.dive', 'the Matriarch\'s presentation is marked and names no strike: no page view takes it, its body plays the attack off its row'],
];
const silent = name => WORDS.find(([word]) => name === word)?.[1] ?? null;
/** One row per kind of word. A pose is a pose whatever body and field it names (one taken is the census's proof that poses land);
 *  an elite's words are drawn each frame under its kind (`Elite.ts`: `elite lane`), so its heard words count there. */
export const family = name => name.startsWith('pose.') ? 'pose' : name.replace(/^elite\.(\w+):.*$/u, 'elite $1');

const picked = arg('heads', Object.keys(HEADS).join(',')).split(','), only = arg('journeys', '').split(',').filter(Boolean);
for (const name of picked) if (HEADS[name] === undefined) throw new Error(`Unknown head ${name}: ${Object.keys(HEADS).join(', ')}`);
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
const launched = await chromium.launch({ args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const browser = { close: () => launched.close(), newContext: options => launched.newContext(options) };

/** One sample of a page's fights: each in progress, whether its bar shows, and whether a body for it is drawn. */
const sampleFights = page => page.evaluate(() => {
  const shown = selector => [...document.querySelectorAll(selector)].some(node => node.classList.contains('show'));
  const bar = shown('[class*="ws-boss"]') || shown('[class*="ws-elite"]');
  const open = Object.values(window.__wildshard?.shard ?? {}).flatMap(script => { try { const body = script?.openFight?.body; return body === undefined ? [] : [body.visible === true]; } catch { return []; } });
  return (window.__workerClientFights?.() ?? []).filter(row => row.state === 'fight').map(row => ({ id: row.id, bar, body: row.shown ?? open.some(Boolean) }));
});
const readPage = page => page.evaluate(() => {
  const report = window.__workerClient();
  return { heard: report.heard ?? {}, drawn: report.drawn, offstage: report.offstage ?? {}, audio: window.__audioTally ?? {}, said: window.__said ?? [] };
});

const census = {};
for (const head of picked) {
  const { slug, journeys, flags } = HEADS[head];
  const row = census[head] = { slug, steps: [], heard: {}, drawn: {}, offstage: {}, audio: {}, bodies: {}, pages: 0 };
  const sampling = new Map();
  pageCensus.sink = {
    opened(_slug, page) {
      const timer = setInterval(() => {
        void sampleFights(page).then(seen => {
          for (const { id, bar, body } of seen) {
            const fight = row.bodies[id] ??= { samples: 0, bar: 0, bodiless: 0 };
            fight.samples++; if (bar) fight.bar++; if (bar && !body) fight.bodiless++;
          }
          return undefined;
        }, () => undefined);
      }, 1500);
      sampling.set(page, timer);
    },
    async closing(_slug, page) {
      clearInterval(sampling.get(page)); sampling.delete(page);
      const seen = await readPage(page).catch(() => null);
      if (seen === null) return;
      row.pages++;
      for (const [name, count] of Object.entries(seen.heard)) row.heard[family(name)] = (row.heard[family(name)] ?? 0) + count;
      for (const [name, count] of Object.entries(seen.drawn)) row.drawn[family(name)] = (row.drawn[family(name)] ?? 0) + count;
      for (const [name, count] of Object.entries(seen.offstage)) row.offstage[family(name)] = (row.offstage[family(name)] ?? 0) + count;
      for (const [name, { played, silent: quiet }] of Object.entries(seen.audio)) { const sound = row.audio[name] ??= { played: 0, silent: 0 }; sound.played += played; sound.silent += quiet; }
    },
  };
  process.argv.push(...flags);
  for (const journey of only.length === 0 ? journeys : journeys.filter(name => only.includes(name))) {
    await fights(browser, phone, base, journey, async (name, run) => {
      const started = Date.now();
      let result;
      try { result = await run(); } catch (error) { result = { ok: false, error: String(error?.message ?? error).slice(0, 300) }; }
      row.steps.push({ name, ok: result?.ok === true, seconds: Math.round((Date.now() - started) / 1000) });
      console.log(`${result?.ok === true ? 'ok  ' : 'FAIL'} ${head} ${name}${result?.ok === true ? '' : ` ${JSON.stringify(result).slice(0, 400)}`}`);
    });
  }
  for (const flag of flags) process.argv.splice(process.argv.indexOf(flag), 1);
  pageCensus.sink = null;
}
await browser.close();

/** The verdict: each head's words heard against drawn, its bodies and its sounds. */
const red = [];
for (const [head, row] of Object.entries(census)) {
  console.log(`\n${head} (${row.slug}): ${row.pages} pages, ${row.steps.filter(step => step.ok).length}/${row.steps.length} steps`);
  console.log(`${'  word'.padEnd(44)}${'heard'.padStart(8)}${'drawn'.padStart(8)}  verdict`);
  for (const name of [...new Set([...Object.keys(row.heard), ...Object.keys(row.drawn)])].sort()) {
    const heard = row.heard[name] ?? 0, drawn = row.drawn[name] ?? 0, offstage = row.offstage[name] ?? 0, why = silent(name);
    // offstage: every word of it was for a view this page hadn't built (a room nobody entered)
    const verdict = heard === 0 ? 'drawn only' : drawn > 0 ? 'drawn' : offstage === heard ? 'offstage: its room was never built' : why !== null ? `silent: ${why}` : 'DARK';
    if (verdict === 'DARK') red.push(`${head}: ${name} heard ${heard}, drawn 0`);
    console.log(`  ${name.slice(0, 41).padEnd(42)}${String(heard).padStart(8)}${String(drawn).padStart(8)}  ${verdict}`);
  }
  for (const [id, fight] of Object.entries(row.bodies)) {
    console.log(`  fight ${id}: ${fight.samples} samples, bar on ${fight.bar}, bar with no body ${fight.bodiless}`);
    if (fight.bodiless > 0) red.push(`${head}: ${id} showed a bar with no body in ${fight.bodiless} of ${fight.bar} samples`);
  }
  for (const [name, sound] of Object.entries(row.audio).sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.startsWith('cue ') && !name.startsWith('music ')) continue;
    console.log(`  audio ${name}: played ${sound.played}, silent ${sound.silent}`);
    if (name.startsWith('cue ') && sound.played === 0) red.push(`${head}: ${name} asked for a sound ${sound.silent} times and none played`);
  }
  // N2: a boss fight the page showed scores it. A sting before the first gesture finds no audio rig yet, so stings only report.
  if (Object.values(row.bodies).some(fight => fight.bar > 0) && (row.audio['music mode:combat']?.played ?? 0) === 0) red.push(`${head}: a boss fight showed its bar and the score never went to combat`);
  for (const step of row.steps) if (!step.ok) red.push(`${head}: step failed: ${step.name}`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ base, census, red }, null, 1)}\n`);
console.log(red.length === 0 ? '\ncensus green' : `\ncensus RED (${red.length}):\n${red.map(line => `  ${line}`).join('\n')}`);
process.exit(red.length === 0 ? 0 : 1);
