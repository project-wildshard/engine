// Meta STAGING-SMOKE SM3 and SM4: the per-release store. Each run keeps its six keyframes per scenario, the clips,
// verdict.json and time to play in <store>/<release>/; the last 5 releases stay. SM4: K1 and K2 leave their profiles (left in
// Driftwood, as Jake's phone is left) in <store>/<release>/profiles/, and the next release's K1 and K2 start from the newest
// pair for the same origin; only the latest pair is kept (each is about 450 MB).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/** @typedef {import('./scenarios.mjs').StorageState} StorageState */
/** @typedef {{ release: string, build?: string, origin: string, clientVersion?: string, states: Partial<Record<'chromium' | 'webkit', StorageState>> }} ProfileNote */

export const STORE = join(homedir(), '.cache/wildshard/plan-artifacts/staging-smoke');
export const KEEP_RELEASES = 5;

/** Every release in the store with a verdict, newest run first.
 * @param {string} store @returns {{ release: string, dir: string, at: string }[]} */
export function releases(store) {
  if (!existsSync(store)) return [];
  return readdirSync(store).flatMap((release) => {
    const file = join(store, release, 'verdict.json');
    if (!existsSync(file)) return [];
    try { return [{ release, dir: join(store, release), at: String(JSON.parse(readFileSync(file, 'utf8')).at ?? '') }]; } catch { return []; }
  }).sort((a, b) => b.at.localeCompare(a.at));
}

/** The newest stored release other than `release`, for the vision judge and time-to-play. @param {string} store @param {string} release */
export function lastRelease(store, release) {
  const row = releases(store).find((r) => r.release !== release);
  if (row === undefined) return undefined;
  /** @type {{ scenarios?: { id: string, timeToPlay?: number, legTimes?: Record<string, number>, frames?: Record<string, string> }[] }} */
  const verdict = JSON.parse(readFileSync(join(row.dir, 'verdict.json'), 'utf8'));
  /** @type {Record<string, number>} */
  const timeToPlay = {};
  for (const s of verdict.scenarios ?? []) {
    if (typeof s.timeToPlay === 'number') timeToPlay[s.id] = s.timeToPlay;
    // SQ12: each K6 card's own time, keyed K6:<slug>
    if (s.id === 'K6') for (const [name, ms] of Object.entries(s.legTimes ?? {})) if (typeof ms === 'number') timeToPlay[`K6:${name}`] = ms;
  }
  return { ...row, verdict, timeToPlay };
}

/** The stored keyframe `name` of scenario `id` in a release dir, if kept. @param {string} dir @param {string} id @param {string} name */
export function storedFrame(dir, id, name) {
  const path = join(dir, id, 'frames', `${name}.jpg`);
  return existsSync(path) ? path : undefined;
}

/**
 * Copy a run into the store: keyframes, clips and verdict.json (with paths pointing into the store), then prune to the last
 * KEEP_RELEASES releases. Returns the release's store dir.
 * @param {string} store @param {string} release @param {string} out @param {any} verdict
 */
export function keepRun(store, release, out, verdict) {
  const dir = join(store, release);
  mkdirSync(dir, { recursive: true });
  // STAGING-QA SQ16: the legs run different scenarios on one release (the candidate K1, K2, K5, K6; after the flip K3, K5), so
  // a scenario this run did not play keeps its stored row
  const file = join(dir, 'verdict.json');
  /** @type {{ id: string, timeToPlay?: number, legTimes?: Record<string, number> }[]} */
  let kept = [];
  if (existsSync(file)) {
    try {
      /** @type {{ build?: string, scenarios?: { id: string }[] }} */
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      const ran = new Set((verdict.scenarios ?? []).map((/** @type {{ id: string }} */ s) => s.id));
      if (stored.build === verdict.build) kept = (stored.scenarios ?? []).filter((s) => !ran.has(s.id));
    } catch { /* an unreadable verdict is replaced */ }
  }
  /** @param {string} path */
  const moved = (path) => path.startsWith(out) ? join(dir, path.slice(out.length + 1)) : path;
  for (const s of verdict.scenarios ?? []) {
    if (existsSync(join(out, s.id, 'frames'))) cpSync(join(out, s.id, 'frames'), join(dir, s.id, 'frames'), { recursive: true });
    if (typeof s.video === 'string' && existsSync(s.video)) { mkdirSync(join(dir, s.id), { recursive: true }); cpSync(s.video, moved(s.video)); s.video = moved(s.video); }
    for (const [name, path] of Object.entries(s.frames ?? {})) s.frames[name] = moved(String(path));
  }
  for (const f of verdict.findings ?? []) {
    if (typeof f.frame === 'string') f.frame = moved(f.frame);
    if (typeof f.video === 'string') f.video = moved(f.video);
    if (typeof f.sheet === 'string' && existsSync(f.sheet)) { cpSync(f.sheet, moved(f.sheet)); f.sheet = moved(f.sheet); }
  }
  for (const v of verdict.vision ?? []) if (typeof v.sheet === 'string' && existsSync(v.sheet)) { cpSync(v.sheet, moved(v.sheet)); v.sheet = moved(v.sheet); }
  // The store keeps both legs. The caller still reports only the leg that ran.
  const storedScenarios = [...kept, ...(verdict.scenarios ?? [])];
  /** @type {Record<string, number>} */
  const timeToPlay = {};
  for (const s of storedScenarios) {
    if (typeof s.timeToPlay === 'number') timeToPlay[s.id] = s.timeToPlay;
    // SQ12: each K6 card's own time, keyed K6:<slug>
    if (s.id === 'K6') for (const [name, ms] of Object.entries(s.legTimes ?? {})) if (typeof ms === 'number') timeToPlay[`K6:${name}`] = ms;
  }
  writeFileSync(join(dir, 'time-to-play.json'), `${JSON.stringify(timeToPlay, null, 1)}\n`);
  writeFileSync(join(dir, 'verdict.json'), `${JSON.stringify({...verdict, scenarios: storedScenarios}, null, 1)}\n`);
  for (const old of releases(store).slice(KEEP_RELEASES)) rmSync(old.dir, { recursive: true, force: true });
  return dir;
}

/** The newest saved profile pair for `origin` from a release other than `release` (a re-run of a held release must start
 * from the release before it, not from its own profiles, already on the candidate).
 * @param {string} store @param {string} origin @param {string} [release] @returns {{ dir: string, note: ProfileNote } | undefined} */
export function newestProfiles(store, origin, release) {
  if (!existsSync(store)) return undefined;
  const rows = readdirSync(store).flatMap((name) => {
    const note = join(store, name, 'profiles', 'note.json');
    if (!existsSync(note)) return [];
    try {
      /** @type {ProfileNote} */
      const parsed = JSON.parse(readFileSync(note, 'utf8'));
      return parsed.origin === origin && parsed.release !== release ? [{ dir: join(store, name, 'profiles'), note: parsed, mtime: statSync(note).mtimeMs }] : [];
    } catch { return []; }
  }).sort((a, b) => b.mtime - a.mtime);
  const row = rows[0];
  return row === undefined ? undefined : { dir: row.dir, note: row.note };
}

/**
 * Save this run's K1 and K2 profiles as the next release's old cache. Two pairs stay: this release's and the newest other
 * release's (what a re-run of this release starts from); older pairs go.
 * @param {string} store @param {ProfileNote} note @param {Partial<Record<'chromium' | 'webkit', string>>} profiles
 */
export function saveProfiles(store, note, profiles) {
  const dir = join(store, note.release, 'profiles');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [browser, path] of Object.entries(profiles)) if (path !== undefined && existsSync(path)) cpSync(path, join(dir, browser), { recursive: true });
  writeFileSync(join(dir, 'note.json'), `${JSON.stringify(note, null, 1)}\n`);
  const keep = newestProfiles(store, note.origin, note.release)?.dir;
  if (existsSync(store)) {
    for (const release of readdirSync(store)) {
      const other = join(store, release, 'profiles');
      if (release !== note.release && other !== keep && existsSync(other)) rmSync(other, { recursive: true, force: true });
    }
  }
  return dir;
}

/** The release folder name a path sits in, for logs. @param {string} dir */
export const releaseOf = (dir) => basename(dir);
