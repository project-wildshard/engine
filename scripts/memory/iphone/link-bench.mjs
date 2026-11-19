#!/usr/bin/env node
// meta IPHONE13-DRIFTWOOD DW6 (mini-driftwood13, 2026-11-19): the time from the link to control, stage by stage, the way a
// player gets there: open the origin, the title's ZONE SELECT, the zone's card, ENTER ZONE, then the loading card's
// START, DOWNLOAD and LOAD phases, then control (safari.mjs's control predicate).
//
//   node scripts/memory/iphone/link-bench.mjs [--zone driftwood-isle] [--runs 5] [--warm 5] [--base <origin>]
//     [--driver inspector|webkit] [--out <dir>] [--dry-run]
//
// Cold: a fresh Safari (fresh WebKit on the Mac), the origin's storage, service worker, caches and IndexedDB cleared, and
// the inspector's resource cache off for the boot (Safari's HTTP cache cannot be emptied without a finger). Warm: the
// same fresh Safari, everything kept from the run before. Phone Low is seeded both ways (safari.mjs phoneSlots).
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { coldOrigin, findButton, pageState, watchPageErrors } from './safari.mjs';
import { bootTimelineEntries } from '../../loading-flow/stalls.mjs';
import { linkTable } from './link.mjs';

const { values } = parseArgs({ options: {
  zone: { type: 'string', default: 'driftwood-isle' }, runs: { type: 'string', default: '5' }, warm: { type: 'string', default: '5' },
  base: { type: 'string', default: 'https://staging.wildshard.io/' }, driver: { type: 'string', default: 'inspector' },
  out: { type: 'string' }, udid: { type: 'string' }, 'dry-run': { type: 'boolean' }, 'with-locks': { type: 'boolean' },
} });
const cold = Number(values.runs), warm = Number(values.warm), base = new URL(values.base).href;
if (!Number.isSafeInteger(cold) || cold < 1 || !Number.isSafeInteger(warm) || warm < 0) throw new Error('--runs is at least 1, --warm at least 0');
const out = resolve(values.out ?? join('tmp/iphone13', `link-${values.zone}-${String(Date.now())}`));
const name = values.zone.replace(/-/gu, ' ');

/** One boot from the origin to control, every stage timed from the navigation. @param {any} driver */
async function linkRun(driver) {
  /** @type {Record<string, number|null>} */
  const at = { menu: null, deck: null, enter: null, startShown: null, startDone: null, downloadShown: null, downloadDone: null, loadShown: null, loadDone: null, control: null };
  const t0 = Date.now(), since = () => (Date.now() - t0) / 1000;
  await driver.navigate(base);
  await watchPageErrors(driver).catch(() => undefined);
  const deadline = t0 + 300_000;
  /** @type {any} */
  let state = null;
  let tappedSelect = 0, tappedEnter = 0, origin;
  while (Date.now() < deadline) {
    state = await driver.evaluate(pageState);
    if (state.timeOrigin !== origin) { origin = state.timeOrigin; await watchPageErrors(driver).catch(() => undefined); }
    if (state.error) return { at, error: state.error, state };
    if (state.control) { at.control = since(); break; }
    if (at.enter === null) {
      const enter = await findButton(driver, ['enter zone']);
      const select = enter === null ? await findButton(driver, ['zone select']) : null;
      if (select !== null && at.menu === null) at.menu = since();
      if (select !== null && Date.now() - tappedSelect > 4_000) { tappedSelect = Date.now(); await driver.click(select.el); }
      if (enter !== null) {
        at.deck ??= since();
        // the zone's own card first (Driftwood is the deck's first, selected card today; others need the tap)
        await driver.evaluate(`for (const el of document.querySelectorAll('.ws-menu-card')) if (el.innerText.toLowerCase().includes(arguments[0])) { if (!el.classList.contains('selected')) el.click(); return; }`, [name]);
        if (Date.now() - tappedEnter > 6_000) { tappedEnter = Date.now(); at.enter ??= since(); await driver.click(enter.el); }
      }
    } else {
      for (const [key, phase] of /** @type {const} */ ([['start', 'st'], ['download', 'dl'], ['load', 'su']])) {
        const pct = state.phases?.[phase]?.pct;
        if (pct !== undefined && pct !== null && pct !== '—' && pct !== '') at[`${key}Shown`] ??= since();
        if (pct === '100') at[`${key}Done`] ??= since();
      }
      // a ready card's own buttons (Skip, Play anyway) are a player's taps too
      const follow = await findButton(driver, ['skip', 'play anyway']);
      if (follow) await driver.click(follow.el);
    }
    await pause(250);
  }
  const spans = at.control === null ? [] : await driver.evaluate(`return (${bootTimelineEntries.toString()})();`).catch(() => []);
  return { at, error: at.control === null ? 'never reached control in 300 s' : null, version: state?.version ?? null, build: state?.build ?? null,
    lastPhases: state?.phases ?? null, spans, consoleErrors: state?.consoleErrors ?? [] };
}

async function bench() {
  mkdirSync(out, { recursive: true });
  const phone = values.driver === 'inspector';
  /** @type {any} */
  let tools = null;
  if (phone) {
    const { doctor } = await import('./doctor.mjs');
    const { startInspector } = await import('./inspector.mjs');
    const facts = doctor({ udid: values.udid, sharedPort: '4444' });
    tools = { facts, inspector: await startInspector(facts.udid, { launchUrl: new URL('/robots.txt', base).href }) };
  }
  /** @type {any[]} */
  const rows = [];
  /** @type {any} */
  let browser = null;
  try {
    for (let i = 0; i < cold + warm; i++) {
      const kind = i < cold ? 'cold' : 'warm';
      /** @type {any} */
      let driver;
      if (phone) driver = await tools.inspector.fresh();
      else {
        // desktop: a new browser per cold run (an empty HTTP cache); the warm runs share the last cold run's browser
        if (kind === 'cold' || browser === null) { await browser?.stop(); const { startWebKit } = await import('./webkit.mjs'); browser = await startWebKit(); }
        driver = browser;
      }
      if (kind === 'cold') {
        await coldOrigin(driver, base, {});
        if (typeof driver.cacheOff === 'function') await driver.cacheOff(true);
      } else if (typeof driver.cacheOff === 'function') await driver.cacheOff(false);
      let row;
      try { row = { kind, ...await linkRun(driver) }; } catch (error) { row = { kind, at: {}, error: error instanceof Error ? error.message : String(error) }; }
      console.log(`${kind} ${String(i + 1)}: ${row.error ?? `control ${String(row.at.control)} s`} ${JSON.stringify(row.at)}`);
      rows.push(row);
      await driver.close?.().catch(() => undefined);
      writeFileSync(join(out, 'link.json'), JSON.stringify(rows, null, 2));
    }
  } finally {
    await tools?.inspector.stop();
    await browser?.stop();
  }
  const text = [`# ${values.zone}: link to control`, '', `${values.driver} · ${base} · ${new Date().toISOString()}`, '', linkTable(rows)].join('\n');
  writeFileSync(join(out, 'link.md'), text);
  console.log(text);
}

if (values['dry-run']) console.log(JSON.stringify({ zone: values.zone, cold, warm, base, driver: values.driver, out }, null, 2));
else if (!values['with-locks']) {
  const root = join(homedir(), 'projects/games/wildshard/engine/tmp');
  mkdirSync(root, { recursive: true });
  const locks = values.driver === 'inspector' ? ['-k', join(root, 'iphone13.lock'), '/usr/bin/lockf', '-k', join(root, 'mini-measure.lock')] : ['-k', join(root, 'mini-measure.lock')];
  const child = spawn('/usr/bin/lockf', [...locks, process.execPath, import.meta.filename, ...process.argv.slice(2), '--out', out, '--with-locks'], { stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} else await bench();
