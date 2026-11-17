// Meta STAGING-SMOKE SM2: the hard checks, each with a severity (STAGING-BUGBASH's scale). P0 blocks play, P1 looks broken,
// P2 is polish. A P0 or P1 holds prod (J398); the rest become STAGING-BUGBASH rows (SM6) and the train goes on.
/** @typedef {'P0' | 'P1' | 'P2'} Severity */
/** @typedef {{ key: string, severity: Severity, ok: boolean, text: string }} Check */
/** @typedef {{ scenario: string, key: string, severity: Severity, text: string, source: 'check' | 'vision', frame?: string, video?: string }} Finding */
/** @typedef {import('./scenarios.mjs').ScenarioResult} ScenarioResult */
/** @typedef {{ build?: string, describe?: string, clientVersion?: string, minClient?: string }} Version */
/** @typedef {{ release: string, version: Version, build?: string, lastTimeToPlay?: Record<string, number>, checkVersion?: boolean }} CheckContext */

/** The journey judge's words that are not P1 on their own: no play is P0, a modal is named by its own check. */
const NOT_P1 = /^never reached play|^an error or drop modal opened$/u;

/** a.b.c below x.y.z @param {string} a @param {string} b */
export function olderVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d < 0; }
  return false;
}

/** Milliseconds from the first leg's tap to play, or undefined when it never played. @param {ScenarioResult} s */
export function timeToPlay(s) {
  const leg = s.legs[0];
  return leg?.playAt === null || leg?.playAt === undefined ? undefined : leg.playAt - leg.tapAt;
}

/**
 * Every check for one scenario, passed or not. A skipped scenario has none.
 * @param {ScenarioResult} s @param {CheckContext} ctx @returns {Check[]}
 */
export function checkScenario(s, ctx) {
  if (s.status === 'skip') return [];
  /** @type {Check[]} */
  const checks = [];
  /** @param {string} key @param {Severity} severity @param {boolean} ok @param {string} text */
  const add = (key, severity, ok, text) => { checks.push({ key, severity, ok, text }); };
  const problems = s.legs.flatMap((leg) => leg.problems.map((p) => ({ leg: leg.name, ...p })));
  const firstPlay = s.legs.find((leg) => leg.playAt !== null)?.playAt ?? null;
  // P0
  const unplayed = s.legs.filter((leg) => leg.playAt === null).map((leg) => leg.name);
  add('play', 'P0', s.status === 'ran' && s.legs.length > 0 && unplayed.length === 0,
    s.status === 'crashed' ? `the scenario stopped: ${s.reason ?? 'unknown'}` : `never reached play (${unplayed.join(', ') || 'no leg ran'})`);
  const errorCard = s.legs.some((leg) => (leg.modals ?? []).includes('error'));
  add('error-card', 'P0', !errorCard, 'an error card (#wserr, .ws-fail) opened');
  const stuck = s.legs.filter((leg) => leg.stick === false).map((leg) => leg.name);
  add('stick', 'P0', stuck.length === 0, `the move stick did not move the player (${stuck.join(', ')})`);
  // P1
  const journey = problems.filter((p) => !NOT_P1.test(p.text));
  add('journey', 'P1', journey.length === 0, journey.map((p) => `${p.leg}: ${p.text} at ${String(p.at)} ms`).join('; ') || 'journey');
  add('page-error', 'P1', s.errors.length === 0, `uncaught page error: ${s.errors.slice(0, 2).map((e) => e.slice(0, 120)).join(' | ')}`);
  if (s.settings !== undefined) add('settings', 'P1', s.settings.opened && s.settings.closed, `title SETTINGS ${s.settings.opened ? 'does not close' : 'does not open'} (SB27)`);
  if (s.quietTitle !== undefined) add('backout-drop', 'P1', !s.quietTitle.drop, 'a drop modal on the title after EXIT TO MAIN MENU');
  // a drop modal on the way into play; after a forced update it is SB30's P2, below
  const dropped = s.legs.filter((leg) => (leg.modals ?? []).includes('drop')).map((leg) => leg.name);
  if (s.oldCache === undefined) add('drop', 'P1', dropped.length === 0, `a drop modal opened on the way into play (${dropped.join(', ')})`);
  const v = ctx.version;
  // SB7 keeps a commit count on an untagged release repair (engineRelease).
  // Admit it only for the requested version and the same full build's SHA.
  const repair = /^(v\d+\.\d+\.\d+)-[1-9]\d*-g([a-f0-9]{7,40})$/u.exec(v.describe ?? '');
  const suffix = repair?.[2];
  const label = v.describe === ctx.release || (repair?.[1] === ctx.release && suffix !== undefined && typeof v.build === 'string' && /^[a-f0-9]{40}$/u.test(v.build) && v.build.startsWith(suffix));
  const named = (ctx.build === undefined || v.build === ctx.build) && v.clientVersion === ctx.release.slice(1) && label;
  if (ctx.checkVersion !== false) add('version', 'P1', named, `/version.json names ${v.build?.slice(0, 8) ?? 'no build'} ${v.describe ?? 'no describe'}, not ${ctx.build?.slice(0, 8) ?? ''} ${ctx.release} (SB7)`.replaceAll(/ {2,}/gu, ' '));
  // the old cache (K1, K2): the candidate on the first page, a forced update's wipe, the save kept
  if (s.oldCache !== undefined) {
    const { before, after, minClient } = s.oldCache;
    // P0 only when the old profile never reaches the candidate; a first page on the old build that the world entry then
    // replaces is P2 (SM9, staging v0.1.34: WebKit showed the v0.1.32 title for 60 s, then entered on the candidate)
    const end = s.endState?.build ?? after.build;
    add('old-cache-build', 'P0', end !== undefined && end === v.build, `the old profile never reached the candidate ${v.build?.slice(0, 8) ?? ''}: it ended on ${end?.slice(0, 8) ?? 'no build'}`);
    if (end === v.build) add('old-cache-first-page', 'P2', after.build === v.build, `the old profile first showed the ${after.build?.slice(0, 8) ?? 'unknown'} title, not the candidate ${v.build?.slice(0, 8) ?? ''}; entering the world loaded the candidate`);
    const saves = before.databases.filter((name) => name.startsWith('wildshard-saves'));
    const lost = saves.filter((name) => !after.databases.includes(name));
    add('old-cache-save', 'P0', lost.length === 0, `the save was lost (${lost.join(', ')})`);
    const forced = minClient !== undefined && before.clientVersion !== undefined && olderVersion(before.clientVersion, minClient);
    if (forced) {
      // read once play has held: the new worker drops the old shell on activation, a few seconds after the title shows, and the
      // new build writes its own ws-built-home-v1, so only caches named for the old build count. P2: the build and save checks
      // above hold what a player meets; a stale cache left behind is disk (SM4, opus-smoke 2026-11-17)
      const last = s.endState ?? after, stamp = before.build?.slice(0, 7);
      const kept = stamp === undefined ? [] : last.caches.filter((name) => before.caches.includes(name) && name.includes(stamp));
      add('old-cache-wipe', 'P2', kept.length === 0, `a forced update (${before.clientVersion ?? ''} below minClient ${minClient ?? ''}) left ${kept.join(', ')} after play`);
    }
    add('forced-drop', 'P2', (s.drops ?? 0) === 0 && dropped.length === 0, 'a drop modal after the forced update (SB30)');
  }
  // P2
  const strip = firstPlay === null ? [] : s.events.filter((e) => e.kind === 'strip' && e.shown === true && e.at >= firstPlay && e.at - firstPlay <= 30_000);
  const closes = s.events.filter((e) => e.kind === 'wsclose').map((e) => `${String(e.code)}${typeof e.reason === 'string' && e.reason !== '' ? ` ${e.reason}` : ''}`);
  add('strip', 'P2', strip.length === 0, `a RECONNECTING strip ${String(Math.round(((strip[0]?.at ?? 0) - (firstPlay ?? 0)) / 1000))} s into play (SB31)${closes.length > 0 ? `; socket closes ${closes.slice(0, 3).join(', ')}` : ''}`);
  const ttp = timeToPlay(s), last = ctx.lastTimeToPlay?.[s.id];
  if (ttp !== undefined && last !== undefined && s.oldCache === undefined && s.id !== 'K1' && s.id !== 'K2') add('slow-play', 'P2', ttp <= last * 1.3, `time to play ${(ttp / 1000).toFixed(1)} s, over 30% slower than the last release's ${(last / 1000).toFixed(1)} s (SB32b)`);
  const long = firstPlay === null ? [] : s.events.filter((e) => e.kind === 'longtask' && e.at >= firstPlay && Number(e.ms) >= 2000);
  add('long-task', 'P2', long.length === 0, `a ${String(Number(long[0]?.ms ?? 0))} ms long task after arrival (SB32)`);
  return checks;
}

/** Checks whose evidence is the title frame, not the last one. */
const TITLE_CHECKS = new Set(['settings', 'version', 'old-cache-first-page']);

/** The failed checks as findings, worst first. @param {ScenarioResult} s @param {Check[]} checks @returns {Finding[]} */
export function findingsOf(s, checks) {
  return checks.filter((c) => !c.ok).map((c) => {
    const frame = (TITLE_CHECKS.has(c.key) ? s.frames.title : undefined) ?? s.frames.last ?? s.frames.play10 ?? s.frames.play1;
    /** @type {Finding} */
    const f = { scenario: s.id, key: c.key, severity: c.severity, text: c.text, source: 'check' };
    if (frame !== undefined) f.frame = frame;
    if (s.video !== undefined) f.video = s.video;
    return f;
  });
}

/** Severity order. @param {Finding} a @param {Finding} b */
export const worstFirst = (a, b) => a.severity.localeCompare(b.severity) || a.scenario.localeCompare(b.scenario);

/** True exactly when a P0 or P1 is present: production go-live refuses (SM5). @param {readonly Finding[]} findings */
export const holds = (findings) => findings.some((f) => f.severity === 'P0' || f.severity === 'P1');

/**
 * The verdict: scenarios with their checks, every finding, and whether it holds prod.
 * @param {readonly ScenarioResult[]} scenarios @param {CheckContext} ctx
 */
export function verdictOf(scenarios, ctx) {
  // /version.json is one fact per run: checked on the first scenario that ran, not five times
  const first = scenarios.find((s) => s.status !== 'skip');
  const rows = scenarios.map((s) => {
    const checks = checkScenario(s, { ...ctx, checkVersion: s === first });
    const ttp = timeToPlay(s);
    return { scenario: s, checks, findings: findingsOf(s, checks), ...(ttp === undefined ? {} : { timeToPlay: ttp }) };
  });
  const findings = rows.flatMap((r) => r.findings).sort(worstFirst);
  return { rows, findings, hold: holds(findings) };
}

/** Runs in the page: which modal is up, for watchLeg. @returns {'error' | 'drop' | null} */
export function modalKind() {
  /** @param {string} sel */
  const up = (sel) => [...document.querySelectorAll(sel)].some((el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).display !== 'none'; });
  if (up('#wserr, .ws-fail')) return 'error';
  if (up('#wsdrop')) return 'drop';
  return null;
}
