#!/usr/bin/env node
// DL23 (E529, G1006, G1008): one recorded load, from the ENTER WORLD tap through 30 s of play, against Jake's bar:
// "every second a bar needs to be moving … no stalls. We can't fucking freeze the browser", and after control "the
// shard's normal fps from second one, no frame over 250 ms". The input is drive.mjs's <mode>-timeline.jsonl (card polls
// every ~200 ms, page frame stamps from a requestAnimationFrame sampler, events); the output is the run's timeline JSON
// (seconds after the tap) with a pass / fail per bar line.
//   node scripts/loading-flow/analyse.mjs <run-dir> [cold|warm|upgrade ...]   # writes <run-dir>/timeline.json, prints the verdicts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** What the player sees on the card; a change in any of these is "something moved" (the clock alone does not count). */
const CARD = ['shown', 'slug', 'tier', 'dl', 'dlPct', 'su', 'suPct', 'line', 'rows', 'err'];
/** The card's newest row without its own running time ('▸ 1 · Application modules…964 ms'): the row's timer is a clock
 *  (sp-x1's review), its step, detail and count are what move. */
const rowName = (text) => (text ?? '').replace(/\d+(?:\.\d+)? ?(?:ms|s)$/u, '');
export const BAR = { stillS: 1, unnamedStepS: 3, loadingFrameMs: 250, playFrameMs: 250, playS: 30 };

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
/** A held step names its wait when the card's foot says what it waits for, or works on a sub-step other than the step's
 *  own title ('Now working on: World program links' under 'step 27 / 30 · First drawn frames'). */
const named = (foot, step) => {
  if (typeof foot !== 'string') return false;
  // 'Reading 8 files · 0.0 MB' is the stage's tally of reads already done (src/shared/engine/boot/waits.ts stageReads), not
  // what it waits on: Nine's step 27 sat 3.5 s behind it with no read in flight
  // (with the footer's own suffixes: its age, files in flight and wait count, sp-x1's review)
  if (/waiting for: Reading \d+ files · [\d.]+ MB(?: · [\d.]+ s)?(?: · \d+ files in flight)?(?: · \d+ waits)?$/u.test(foot)) return false;
  if (/waiting for:/iu.test(foot)) return true;
  const work = /working on: (.+)$/iu.exec(foot)?.[1]?.trim();
  const title = (step ?? '').replace(/^step \d+ \/ \d+ · /u, '').trim();
  return work !== undefined && work !== '' && work !== title && !title.endsWith(work);
};
/** The wait text without its running seconds, so one wait is listed once. */
const waitName = (foot) => foot.replaceAll(/ · \d+(?:\.\d+)? s\b/gu, '').replace(/^No reported progress for [\d.]+ s · /u, '');

/** A page lifetime token, recorded in the sampler and polls, survives clock jitter
 * and changes on a same-URL reload. URL and timeOrigin are never identity. */
const documentId = row => typeof row?.documentId === 'string' && row.documentId !== '' ? row.documentId : null;
const sameDocument = (a, b) => documentId(a) !== null && documentId(a) === documentId(b);

/** Anchor each document's relative frame clock once. A later timeOrigin read
 * can jitter on Safari; durations come from that document's performance clock. */
function frameGaps(rows) {
  const gaps = [], origins = new Map();
  let last = null;
  for (const row of rows) {
    if (row.ev !== 'frames') continue;
    const id = documentId(row);
    if (id === null || !Number.isFinite(row.origin)) { last = null; continue; }
    if (!origins.has(id)) origins.set(id, row.origin);
    for (const at of row.f) {
      const epoch = origins.get(id) + at;
      if (last !== null && last.documentId === id && at > last.at)
        gaps.push({ at: epoch, ms: at - last.at, documentId: id });
      last = { documentId: id, at };
    }
  }
  return gaps;
}

/**
 * @param {Array<Record<string, any>>} rows one mode's timeline.jsonl rows, in order
 * @param {string | null} [servedBuild] run.json's version: an old worker can hold the old page after a deploy, so a run says which build it read
 */
export function analyse(rows, servedBuild = null) {
  const events = new Map(rows.filter(row => row.ev !== 'poll' && row.ev !== 'frames').map(row => [row.ev, row]));
  const tap = events.get('tapEnter')?.t;
  if (tap === undefined) throw new Error('no tapEnter event: the run never reached ENTER WORLD');
  const rec = events.get('recStart')?.recStart ?? tap;
  const T = (ms) => round((ms - tap) / 1000);
  const polls = rows.filter(row => row.ev === 'poll' && row.t >= tap);
  const controlRow = polls.find(row => row.control === true);
  const control = controlRow?.t ?? null;
  const end = control ?? polls.at(-1)?.t ?? tap;
  const frameRows = rows.filter(row => row.ev === 'frames');
  const loadingIdentity = frameRows.length > 0 && frameRows.every(row => documentId(row) !== null && Number.isFinite(row.origin));
  const playPolls = control === null ? [] : polls.filter(row => row.t >= control && row.t <= control + BAR.playS * 1000);
  const playIdentity = playPolls.length > 0 && playPolls.every(row => sameDocument(row, controlRow));

  const firsts = {};
  const first = (key, row, extra = {}) => { if (!(key in firsts)) firsts[key] = { t: T(row.t), ...extra }; };
  for (const row of polls) {
    if (row.shown) first('cardAppears', row, { clock: row.clock, styled: row.styled ?? null });
    if (row.clock && row.clock !== '00:00.0') first('clockMoves', row, { clock: row.clock });
    if (row.slug && row.tier) first('slugTierFill', row, { slug: row.slug, tier: row.tier.split(' · ')[0] });
    const mb = /^Spawn view · ([\d.]+) MB of/u.exec(row.dl ?? '');
    if (mb && Number(mb[1]) > 0) first('downloadMoves', row, { dl: row.dl });
    if (row.dlPct === '100' || ((row.dl ?? '').startsWith('Spawn view') && !(row.dl ?? '').includes(' of '))) first('download100', row, { dl: row.dl });
    if (row.suPct && !['0', '—'].includes(row.suPct)) first('setupMoves', row, { pct: row.suPct, step: row.su });
    if (row.control) first('control', row);
  }

  // card unchanged for a second or more between the tap and control (clock excluded: it ticks on a frozen card)
  const still = [];
  let from = null;
  const loading = polls.filter(row => row.t <= end);
  for (let i = 0; i < loading.length; i++) {
    const row = loading[i];
    if (from === null) { from = row; continue; }
    // the foot's wait counts (files, MB) move the card; its running seconds and 'No reported progress for' are a clock
    const same = CARD.every(key => row[key] === from[key]) && rowName(row.lastRow) === rowName(from.lastRow)
      && waitName(row.foot ?? '') === waitName(from.foot ?? '');
    if (!same || i === loading.length - 1) {
      const s = (row.t - from.t) / 1000;
      if (s >= BAR.stillS && from.shown) still.push({ from: T(from.t), to: T(row.t), s: round(s), step: from.su, pct: from.suPct, dl: from.dl, foot: from.foot ?? null });
      from = row;
    }
  }
  // a setup step (its text and %) unchanged for 3 s; it passes when the card names what it waits on, with no unnamed
  // stretch of a second or more inside it (a one-poll blip between two named waits is not a silent step)
  const stalls = [];
  from = null;
  let held = [];
  for (let i = 0; i < loading.length; i++) {
    const row = loading[i];
    if (from === null) { if (row.shown) { from = row; held = [row]; } continue; }
    if (row.su !== from.su || row.suPct !== from.suPct || i === loading.length - 1) {
      const s = (row.t - from.t) / 1000;
      if (s >= BAR.unnamedStepS) {
        let quiet = 0, quietFrom = null, before = null;
        for (const poll of [...held, row]) {
          // a spawn download on a real link holds the card before its first step: its own row names it, for as long as its bytes move
          const downloading = /\bof [\d.]+ MB\b/u.test(poll.dl ?? '') && poll.dl !== before?.dl;
          if (poll !== row && !downloading && !named(poll.foot, from.su)) quietFrom ??= poll.t;
          else if (quietFrom !== null) { quiet = Math.max(quiet, poll.t - quietFrom); quietFrom = null; }
          before = poll;
        }
        stalls.push({ from: T(from.t), to: T(row.t), s: round(s), step: from.su, pct: from.suPct, named: quiet < 1000,
          longestUnnamedS: round(quiet / 1000), waits: [...new Set(held.filter(poll => named(poll.foot, from.su)).map(poll => waitName(poll.foot)))].slice(0, 4) });
      }
      from = row; held = [row];
    } else held.push(row);
  }

  const gaps = frameGaps(rows);
  const worst = (list) => list.reduce((a, b) => (b.ms > a.ms ? b : a), { at: tap, ms: 0 });
  const loadGaps = gaps.filter(g => g.at > tap && g.at <= end);
  // the longest loading frame per Setup step (wildshard-new's ruling: an unpresented frame over 250 ms is a freeze to
  // Jake's eye whatever the label, and DL10 batches them by step): each gap goes to the step the card showed as it began
  const stepAt = (at) => {
    let step = null;
    for (const row of loading) { if (row.t > at) break; if (row.su) step = row.su.replace(/^step (\d+) \/ \d+ · ([^·]+).*$/u, '$1 $2').trim(); }
    return step ?? 'before the card';
  };
  const byStep = new Map();
  for (const g of loadGaps) {
    const step = stepAt(g.at - g.ms), row = byStep.get(step) ?? { step, longestMs: 0, over250: 0 };
    row.longestMs = Math.max(row.longestMs, Math.round(g.ms)); if (g.ms > BAR.loadingFrameMs) row.over250++;
    byStep.set(step, row);
  }
  const loadWorst = worst(loadGaps);
  /** fps, per-second counts and the longest frame of `frames` ({at, ms}) in the play window after control */
  const playStats = (frames, source) => {
    const stop = control + BAR.playS * 1000;
    const inside = frames.filter(g => g.at > control && g.at <= stop);
    const seen = inside.length > 0 ? (inside.at(-1).at - control) / 1000 : 0;
    const perSecond = [];
    for (let s = 0; s < BAR.playS; s++) perSecond.push(inside.filter(g => g.at > control + s * 1000 && g.at <= control + (s + 1) * 1000).length);
    const top = worst(inside);
    // every covered second counts, a second with no frame too (sp-x1: dropping zeros let a stopped world read as settled)
    const settled = perSecond.slice(10).sort((a, b) => a - b);
    return { source, sampledS: round(seen), frames: inside.length, fps: seen > 0 ? round(inside.length / seen) : 0,
      firstSecondFps: perSecond[0], settledFps: settled.length > 0 ? settled[Math.floor(settled.length / 2)] : 0,
      lowestSecondFps: Math.min(...perSecond.slice(0, Math.max(1, Math.floor(seen)))),
      longestFrameMs: Math.round(top.ms), longestFrameAt: T(top.at), framesOver250: inside.filter(g => g.ms > BAR.playFrameMs).length, perSecond };
  };
  let play = null;
  if (control !== null) {
    // the game's drawn frames (it paces its draws, so the page's rAF can tick at 60 while the world draws at 5): each poll
    // reads frames drawn since start and the 120-slot ring of their times; the new slots spread over the poll interval
    // Each poll's new frames stand back from the page's own clock as the poll read it, by their own lengths: a reply reaches this
    // machine late on a busy Mac (Nalati cold on 071837b: 307 ms, so 577 ms of frames read as 877 and the next 807 as 534, a 17 then a 38
    // at a steady 30), and a stall before a poll holds no frames to spread over it (Pine, 13 frames of 578 ms in a 2,205 ms interval)
    const paged = Number.isFinite(controlRow?.now) && Number.isFinite(controlRow?.origin);
    const pageTime = (row) => (paged && Number.isFinite(row.now) ? control + row.now - controlRow.now : row.t);
    const drawn = [];
    let prev = null;
    for (const row of polls) {
      if (!row.drawn) continue;
      if (prev !== null && row.drawn.n > prev.drawn.n && sameDocument(row, prev) && sameDocument(row, controlRow)) {
        const k = Math.min(row.drawn.ms.length, row.drawn.n - prev.drawn.n), size = row.drawn.ms.length;
        const frames = Array.from({ length: k }, (_, j) => row.drawn.ms[(row.drawn.i - k + j + size * 2) % size]);
        let at = pageTime(row) - frames.reduce((sum, ms) => sum + ms, 0);
        for (const ms of frames) { at += ms; drawn.push({ at, ms }); }
      }
      prev = row;
    }
    // a ring that stops advancing while the polls go on is a world that stopped drawing (sp-x1): the time from its last
    // drawn frame to its last poll in the window is one open frame, as the HUD meter counts its pending interval
    const lastDrawnAt = drawn.at(-1)?.at ?? control, windowEnd = control + BAR.playS * 1000;
    const lastPoll = polls.findLast(row => row.drawn && row.t <= windowEnd && sameDocument(row, controlRow));
    if (drawn.length > 0 && lastPoll !== undefined && lastPoll.t > lastDrawnAt) drawn.push({ at: lastPoll.t, ms: lastPoll.t - lastDrawnAt, open: true });
    const page = playStats(gaps.filter(gap => gap.documentId === documentId(controlRow)), 'page requestAnimationFrame');
    // what the player did: metres walked and boarded, top speed on the board (drive.mjs's walk, then hoverboard + boost)
    const motion = { walkM: 0, boostM: 0, boostTopMps: 0, boostEngaged: false };
    let last = null;
    for (const row of polls) {
      if (row.t < control || row.t > control + BAR.playS * 1000 || !row.player) continue;
      if (last !== null) {
        const d = Math.hypot(row.player.x - last.x, row.player.z - last.z);
        if (row.play === 'boost') { motion.boostM += d; motion.boostEngaged ||= row.player.boost === true && row.player.hover === true; motion.boostTopMps = Math.max(motion.boostTopMps, row.player.v); }
        else if (row.play === 'walk') motion.walkM += d;
      }
      last = row.player;
    }
    motion.walkM = Math.round(motion.walkM); motion.boostM = Math.round(motion.boostM);
    play = { ...(drawn.length > 0 ? { ...playStats(drawn, 'game drawn frames'), page } : { ...page, page: null }), motion };
  }

  const errors = [...new Set(polls.map(row => row.err).filter(Boolean))];
  const retryShown = polls.some(row => row.retry === true);
  // covered means the game's frame ring was read at or after control + 30 s (unrounded; sp-x1: a log ending at 29 s
  // left its last second unseen)
  const lastRing = control === null ? undefined : polls.findLast(row => row.drawn && row.t >= control && sameDocument(row, controlRow));
  const playCoveredS = lastRing === undefined || control === null ? 0 : (lastRing.t - control) / 1000;
  if (play !== null) play.coveredS = round(playCoveredS, 2);
  const playJudged = playIdentity && loadingIdentity && play !== null && play.source === 'game drawn frames' && play.frames > 0 && playCoveredS >= BAR.playS;
  const ranBuild = polls.findLast(row => typeof row.build === 'string')?.build ?? null;
  const bar = {
    reachesControl: control !== null,
    styledFromFirstFrame: firsts.cardAppears?.styled !== false && polls.filter(row => row.shown && row.t <= end).every(row => row.styled !== false),
    cardMovesEverySecond: still.length === 0,
    noLoadingFrameOver250ms: loadingIdentity && loadGaps.length > 0 && loadWorst.ms <= BAR.loadingFrameMs,
    everyLongStepNamed: stalls.every(s => s.named),
    // the play lines need the whole window, judged on the game's own drawn frames (sp-x1's review): a short log or one
    // without the game's frame ring is no reading, so it fails rather than passes on the page's 60 Hz rAF
    playNoFrameOver250ms: playJudged && play.framesOver250 === 0 && (play.page?.framesOver250 ?? 0) === 0,
    // "normal fps from second one": no second of the first five below 80 % of the shard's settled rate (seconds 10-30)
    playSteadyFromSecondOne: playJudged && play.settledFps > 0 && play.perSecond.slice(0, 5).every(n => n >= 0.8 * play.settledFps),
    stuckShowsRetry: control !== null || retryShown,
    // the play window really walked and boosted (an unmoved player would read a smooth standstill)
    playWalkedAndBoosted: play !== null && play.motion.walkM >= 5 && play.motion.boostEngaged && play.motion.boostM > play.motion.walkM,
    // a recording older than the build field has no line here
    ...(ranBuild !== null && servedBuild !== null ? { ranServedBuild: ranBuild === servedBuild } : {}),
  };
  return {
    unit: 'seconds after the ENTER WORLD tap',
    shard: events.get('tapEnter')?.shard ?? null,
    ranBuild,
    tapAtRecordingS: round((tap - rec) / 1000),
    milestones: firsts,
    controlS: control === null ? null : T(control),
    cardStill_ge1s: still,
    setupStalls_ge3s: stalls,
    loading: { frames: loadGaps.length, longestFrameMs: Math.round(loadWorst.ms), longestFrameAt: T(loadWorst.at),
      framesOver250: loadGaps.filter(g => g.ms > BAR.loadingFrameMs).length,
      byStep: [...byStep.values()].filter(row => row.longestMs > 100).sort((a, b) => b.longestMs - a.longestMs) },
    play: playIdentity && loadingIdentity ? play : null,
    documentIdentity: { loading: loadingIdentity, play: playIdentity, missingRows: rows.filter(row => (row.ev === 'frames' || row.ev === 'poll') && documentId(row) === null).length },
    errors,
    retryShown,
    bar,
    pass: Object.values(bar).every(Boolean),
  };
}

export function readRun(dir, mode) {
  const file = join(dir, `${mode}-timeline.jsonl`);
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, ...asked] = process.argv.slice(2);
  if (!dir) { console.error('usage: analyse.mjs <run-dir> [cold|warm|upgrade ...]'); process.exit(2); }
  const modes = asked.length > 0 ? asked : ['cold', 'warm', 'upgrade'].filter(mode => existsSync(join(dir, `${mode}-timeline.jsonl`)));
  const meta = existsSync(join(dir, 'run.json')) ? JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) : {};
  const out = { ...meta, bar: BAR };
  for (const mode of modes) {
    const result = analyse(readRun(dir, mode), meta.version?.build ?? null);
    out[mode] = result;
    const p = result.play;
    const line = [`${mode}: ${result.pass ? 'PASS' : 'FAIL'}`, `control ${result.controlS ?? 'never'} s`, `card still ≥1 s ×${result.cardStill_ge1s.length}`,
      `unnamed ≥3 s steps ×${result.setupStalls_ge3s.filter(s => !s.named).length}`, `loading frame max ${result.loading.longestFrameMs} ms`];
    if (p) line.push(`play ${p.fps} fps (1st s ${p.firstSecondFps}, settled ${p.settledFps}) max ${p.longestFrameMs} ms`);
    console.log(line.join('  '));
    const slow = result.loading.byStep.filter(row => row.longestMs > BAR.loadingFrameMs).map(row => `${row.step} ${row.longestMs} ms${row.over250 > 1 ? ` (x${row.over250})` : ''}`);
    if (slow.length > 0) console.log(`  loading frames > ${BAR.loadingFrameMs} ms by step: ${slow.join(' · ')}`);
    for (const [rule, ok] of Object.entries(result.bar)) if (!ok) console.log(`  ✗ ${rule}${rule === 'ranServedBuild' ? ` (ran ${result.ranBuild}, served ${meta.version.build})` : ''}`);
  }
  writeFileSync(join(dir, 'timeline.json'), `${JSON.stringify(out, null, 1)}\n`);
}
