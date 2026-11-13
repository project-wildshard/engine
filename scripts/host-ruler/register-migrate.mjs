#!/usr/bin/env node
// HOST-RULER HR5 (meta docs/plans/HOST-RULER-PLAN.md): build lint/host-register.json from the old lists, once.
// Sources: engine lint/platform-pending-users.json, scripts/platform-chargebacks.mjs, lint/host-reviews.json,
// lint/listed-view-code.json, and singleplayer docs/HOST-BAR.md's G571 and G599–G677 lines at a pinned SHA. HR9
// deletes the engine lists (and this script) with the old ruler; the register is then the only list.
// Usage: node scripts/host-ruler/register-migrate.mjs [--write|--check] [--singleplayer <dir>] [--meta <dir>]
//   --check (default) rebuilds the register and refuses if the committed one differs; --write rewrites it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platformChargeback } from '../platform-chargebacks.mjs';
import { ENGINE_ROOT } from './roots.mjs';
import { RECHECK, REGISTER, TESTS, formatRegister, moduleFile, namesBinding, readHostRegister } from './register.mjs';

const SINGLEPLAYER_SHA = '48d24fdbbd';
const META_PLAN = 'docs/plans/multi-repo/MULTI-REPO-PLAN.md';
const args = process.argv.slice(2);
/** @param {string} name @param {string} fallback */
const option = (name, fallback) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1] ?? fallback; };
const singleplayer = resolve(option('--singleplayer', join(ENGINE_ROOT, '../../wildshard-singleplayer')));
const meta = resolve(option('--meta', join(ENGINE_ROOT, '../../project-wildshard-meta')));
/** @param {string} dir @param {string} rev @param {string} path */
const show = (dir, rev, path) => execFileSync('git', ['-C', dir, 'show', `${rev}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
const META_SHA = '4112be3';
const ENGINE_SOURCES = ['lint/platform-pending-users.json', 'scripts/platform-chargebacks.mjs', 'lint/host-reviews.json', 'lint/listed-view-code.json'];
if (execFileSync('git', ['-C', ENGINE_ROOT, 'status', '--porcelain', '--', ...ENGINE_SOURCES], { encoding: 'utf8' }).trim() !== '') throw new Error('register-migrate: an old list has uncommitted edits; its SHA would not describe it');
const engineSha = execFileSync('git', ['-C', ENGINE_ROOT, 'log', '-1', '--format=%h', '--', 'lint/platform-pending-users.json', 'scripts/platform-chargebacks.mjs', 'lint/host-reviews.json', 'lint/listed-view-code.json'], { encoding: 'utf8' }).trim();

// The written path rule (as g571-hosts.mjs's hostFile): HOST-BAR's `format/x` is the pinned format package's
// `@wildshard/format/src/format/x.ts`; `engine|game/<side>/x` is side-first `src/<side>/<layer>/x.ts` (J122), tried on
// the named side first and then the others, since a retag moves the file, not the approval; an unsided `engine|game/x`
// takes the first side that has it. The old `src/<layer>/<side>/x.ts` and `src/format/x.ts` paths map the same way.
const SIDES = ['client', 'shared', 'server', 'cook'];
/** @param {string} selector @returns {{module:string, binding?:string}|null} */
export function sideFirst(selector) {
  const [path = '', binding] = selector.split('#');
  const bare = path.replace(/^src\//u, '').replace(/\.ts$/u, '');
  /** @param {string} module */
  const found = module => moduleFile(module) === null ? null : module;
  let module = null;
  if (bare.startsWith('format/')) module = found(`@wildshard/format/src/${bare}.ts`);
  else {
    const match = /^(engine|game)\/(?:(client|shared|server|cook)\/)?(.+)$/u.exec(bare);
    if (match !== null) {
      const [, layer, side, rest] = match;
      for (const candidate of side === undefined ? SIDES : [side, ...SIDES.filter(other => other !== side)]) module ??= found(`src/${candidate}/${layer}/${rest}.ts`);
    } else if (SIDES.includes(bare.split('/')[0] ?? '')) module = found(`src/${bare}.ts`);
  }
  return module === null ? null : binding === undefined ? { module } : { module, binding };
}

/** @typedef {{source:string, line:number, selector:string}} From */
/** @typedef {{key:string, verdict:string, decision:string, users:string[], recheck?:string, score?:Record<string,0|1>, note?:string, from:From[], rank:number}} Draft */
/** @type {Draft[]} */
const drafts = [];
/** @type {{key:string, from:From, reason:string}[]} */
const dropped = [];
/** @type {Record<string, number>} */
const counts = {};
/** @param {string} module */
const layerVerdict = module => /^src\/\w+\/engine\//u.test(module) ? 'engine' : 'game';
/** Precedence on a shared key, as the old ruler applied it: a Jake-approved HOST-BAR host beats a chargeback; a
 * chargeback beats an approved pending-user feature; listed and reviewed rows sit between. */
const RANK = { hostBarApproved: 6, chargebacks: 5, listedView: 4, hostReviews: 3, pendingApproved: 2, hostBarPending: 1, pendingW3: 0 };
/** @param {string} source @param {number} line @param {string} selector @param {Omit<Draft,'key'|'from'|'rank'>} row @param {number} rank */
function add(source, line, selector, row, rank) {
  counts[source] = (counts[source] ?? 0) + 1;
  const from = { source, line, selector }, mapped = sideFirst(selector);
  if (selector.endsWith('.test.ts')) { dropped.push({ key: selector, from, reason: 'a test file the line cites, not a host' }); return; }
  if (mapped === null) { dropped.push({ key: selector, from, reason: 'no such module in engine or the pinned format package' }); return; }
  const file = moduleFile(mapped.module);
  if (mapped.binding !== undefined && file !== null && !namesBinding(readFileSync(file, 'utf8'), mapped.binding)) {
    dropped.push({ key: `${mapped.module}#${mapped.binding}`, from, reason: 'the module no longer names this binding' }); return;
  }
  drafts.push({ key: mapped.binding === undefined ? mapped.module : `${mapped.module}#${mapped.binding}`, from: [from], rank, ...row });
}
/** @param {string} text @param {string} needle @param {string} [after] the needle's first match after this anchor */
const lineOf = (text, needle, after = '') => {
  const index = text.indexOf(needle, after === '' ? 0 : text.indexOf(after));
  if (index === -1) throw new Error(`register-migrate: not found: ${needle}`);
  return text.slice(0, index).split('\n').length;
};

// 1. Pending users (G419): an approved feature (G473–G484) is platform on its decision, also when it names a W3 shard
// (the old reader credited approvedFeature before the shard); a W3 entry without one is pending.
const pendingText = readFileSync(join(ENGINE_ROOT, 'lint/platform-pending-users.json'), 'utf8');
{
  /** @type {{module:string, export?:string, shard?:string, plan?:{row:string}, approvedFeature?:{name:string, decision:{row:string}}}[]} */
  const entries = JSON.parse(pendingText).entries;
  let at = 0;
  for (const entry of entries) {
    at = pendingText.indexOf(`"module": "${entry.module}"`, at + 1);
    if (at === -1) throw new Error(`register-migrate: entry out of order: ${entry.module}`);
    const line = pendingText.slice(0, at).split('\n').length, selector = entry.export === undefined ? entry.module : `${entry.module}#${entry.export}`;
    const users = entry.shard === undefined ? [] : [entry.shard];
    if (entry.approvedFeature !== undefined) {
      add('pending-users', line, selector, { verdict: layerVerdict(sideFirst(selector)?.module ?? ''), decision: entry.approvedFeature.decision.row, users,
        note: `approved feature: ${entry.approvedFeature.name}${entry.plan === undefined ? '' : `; W3 row: ${entry.plan.row}`}` }, RANK.pendingApproved);
    } else {
      const decision = /G\d+/u.exec(entry.plan?.row ?? '')?.[0] ?? 'G419';
      add('pending-users', line, selector, { verdict: 'pending', decision, users, recheck: RECHECK, note: `W3 row: ${entry.plan?.row ?? ''}` }, RANK.pendingW3);
    }
  }
}

// 2. HOST-BAR at the pinned SHA. `- G571` lines and the four G599–G677 lines that are not "Jake-approved host:" are
// pending (G595: every one-user host needs Jake's own approval); the 31 "Jake-approved host:" lines are platform on
// their G number. Every backticked selector is a row; a line without one names its host in plain text (HAND).
const hostBar = show(singleplayer, SINGLEPLAYER_SHA, 'docs/HOST-BAR.md');
/** Lines whose host is not a backticked selector, by line number: the selector their prose names. */
const HAND = new Map([
  [76, ['format/postGraphLook#PaintedWorldSchema', 'game/looks/postGraphLook#paintedWorld', 'game/looks/postGraphLook#paintedWorldOf']],
  [141, ['game/quest/continuation#installQuestContinuationFile']],
]);
for (const [index, text] of hostBar.split('\n').entries()) {
  const line = index + 1, legacy = /^- G571\b/u.test(text), later = /^- G(?:599|6[0-6]\d|67[0-7])\b/u.test(text);
  if (!legacy && !later) continue;
  const approved = later && /^- G\d+(?: [A-Z]\d+[a-z]?)? Jake-approved host:/u.test(text);
  const decision = /G\d+/u.exec(text)?.[0] ?? 'G571';
  const tag = /^- (G\d+(?: [A-Z]\d+[a-z]?)?(?: \/ G\d+ [A-Z]\d+)?)/u.exec(text)?.[1] ?? decision;
  const selectors = [...text.matchAll(/`((?:src\/)?(?:engine|game|format|sdk|sharddev)\/[A-Za-z0-9_./-]+(?:#[A-Za-z_$][\w$]*)?)`/gu)].map(match => match[1] ?? '');
  const hosts = HAND.get(line) ?? [...new Set(selectors)];
  if (!hosts.some(selector => !selector.endsWith('.test.ts'))) throw new Error(`register-migrate: HOST-BAR line ${line} names no host selector; add it to HAND`);
  for (const selector of hosts) {
    if (approved) add('host-bar', line, selector, { verdict: layerVerdict(sideFirst(selector)?.module ?? ''), decision, users: [], note: `${tag} Jake-approved host` }, RANK.hostBarApproved);
    else add('host-bar', line, selector, { verdict: 'pending', decision, users: [], recheck: RECHECK, note: legacy ? `${tag} day-one host (test 1 waived), not yet approved one by one (G595)` : `${tag}: not a "Jake-approved host:" line` }, RANK.hostBarPending);
  }
}

// 3. Chargebacks (G520 / G496 cut list): every reviewed single-shard charge is a silly row on its owner.
const chargeText = readFileSync(join(ENGINE_ROOT, 'scripts/platform-chargebacks.mjs'), 'utf8');
/** [selector, owner, decision, needle in platform-chargebacks.mjs, checked through platformChargeback(), anchor]
 * @type {[string, string, string, string, boolean, string?][]} */
const CHARGES = ([
  ['src/game/boss/arenaScript.ts', 'nalati-grasslands', 'G520', "'game/boss/arenaScript'", true],
  ['src/game/boss/arenaField.ts', 'nalati-grasslands', 'G520', "'game/boss/arenaField'", true],
  ['src/client/game/models/mountedSpecimen.ts', 'nalati-grasslands', 'G530', "['src/client/game/models/mountedSpecimen.ts'", true],
  ['src/client/game/shardfile/worldAssembly.ts#installAssemblyArenaScript', 'nalati-grasslands', 'G665', "['installAssemblyArenaScript'", true],
  ['src/client/game/looks/speciesBook.ts#SpeciesLookBook', 'nalati-grasslands', 'G520', "'SpeciesLookBook'", true],
  ['src/client/game/looks/speciesBook.ts#packedRows', 'nalati-grasslands', 'G520', "'packedRows'", true],
  ['src/client/game/practice/course.ts#MountedCourseEntry', 'nalati-grasslands', 'G520', "'MountedCourseEntry'", true],
  ['src/client/game/practice/course.ts#GrappleCourseEntry', 'nine-dragon-stack', 'G520', "'GrappleCourseEntry'", true],
  ['src/client/game/practice/course.ts#MountEntryRows', 'nalati-grasslands', 'G520', "'MountEntryRows'", true],
  ['src/client/game/practice/course.ts#GrappleEntryRows', 'nine-dragon-stack', 'G520', "'GrappleEntryRows'", true],
  ['src/client/game/boss/encounterView.ts#SlotEncounterView', 'nalati-grasslands', 'G520', "'SlotEncounterView'", true],
  ['src/client/game/boss/encounterView.ts#PatrolEncounterView', 'nalati-grasslands', 'G520', "'PatrolEncounterView'", true],
  ['src/shared/game/boss/slotLaw.ts#SlotEncounterLaw', 'nalati-grasslands', 'G520', "'SlotEncounterLaw'", true],
  ['src/client/game/shardfile/worldScenes.ts#WorldScenePoolPublications', 'nine-dragon-stack', 'G520', "['src/client/game/shardfile/worldScenes.ts', new Map([['WorldScenePoolPublications'", true],
  ['src/client/game/shardfile/scenePools.ts#WorldSceneTierPools', 'nine-dragon-stack', 'G520', "['src/client/game/shardfile/scenePools.ts', new Map([['WorldSceneTierPools'", true],
  ['src/format/worldScenes.ts#WorldSceneTierPools', 'nine-dragon-stack', 'G520', "['src/format/worldScenes.ts', new Map([['WorldSceneTierPools'", true],
  ['src/format/worldScenes.ts#WorldScenePoolPublications', 'nine-dragon-stack', 'G520', "['WorldScenePoolPublications', 'C1']])]", true, "['src/format/worldScenes.ts', new Map([['WorldSceneTierPools'"],
  ['src/client/game/quest/carriedProp.ts', 'nalati-grasslands', 'G520', '["src/client/game/quest/carriedProp.ts", null]', false],
  ['src/shared/engine/combat/effects/types.ts#SourceMulDef', 'nalati-grasslands', 'G520', '"SourceMulDef"', false],
  ['src/shared/engine/combat/effects/types.ts#anyTag', 'nalati-grasslands', 'G520', '"anyTag"', false],
  ['src/shared/engine/combat/effects/types.ts#sourceMultiplier', 'nalati-grasslands', 'G520', '"sourceMultiplier"', false],
  ['src/client/game/shardfile/scenePools.ts#WorldSceneTierPools', 'nine-dragon-stack', 'G520', "['src/client/game/shardfile/scenePools.ts', new Map([['WorldSceneTierPools', [", false],
  ['src/client/game/shardfile/worldScenes.ts#WorldScenePoolPublications', 'nine-dragon-stack', 'G520', "['WorldScenePoolPublications', [", false],
  ['src/format/worldScenes.ts#WorldScenePoolPublications', 'nine-dragon-stack', 'G520', "['WorldScenePoolPublications', [[", false],
  ['src/format/worldScenes.ts#WorldSceneTierPools', 'nine-dragon-stack', 'G520', "['WorldSceneTierPools', [\n", false, "['src/format/worldScenes.ts', new Map([\n"],
]);
for (const [selector, owner, decision, needle, table, after] of CHARGES) {
  const [path = '', name] = selector.split('#');
  if (table && platformChargeback(path, name) === null && platformChargeback(path) === null) throw new Error(`register-migrate: not a chargeback: ${selector}`);
  const kind = table ? 'chargeback' : needle.startsWith('["') || needle.startsWith('"') ? 'chapter-facet owner' : 'inline span';
  add('chargebacks', lineOf(chargeText, needle, after), selector, { verdict: 'silly', decision, users: [owner], note: `${kind}, charged to ${owner}` }, RANK.chargebacks);
}

// 4. Host reviews (G456) and 5. listed view code (G570) carry over.
const reviewText = readFileSync(join(ENGINE_ROOT, 'lint/host-reviews.json'), 'utf8');
/** @type {Record<string,{evidence:string, verdicts:Record<string,string>}>} */
const reviews = JSON.parse(reviewText).entries;
for (const [selector, review] of Object.entries(reviews)) {
  /** @type {Record<string,0|1>} */
  const score = {};
  for (const [test, verdict] of Object.entries(review.verdicts)) { if (!TESTS.includes(/** @type {typeof TESTS[number]} */ (test))) throw new Error(`register-migrate: unknown test ${test}`); score[test] = verdict === 'pass' ? 1 : 0; }
  add('host-reviews', lineOf(reviewText, `"${selector}"`), selector.replace(/#\*$/u, ''), { verdict: 'borderline', decision: /G\d+/u.exec(review.evidence)?.[0] ?? 'G456', users: ['nalati-grasslands'], recheck: RECHECK, score, note: review.evidence }, RANK.hostReviews);
}
const viewText = readFileSync(join(ENGINE_ROOT, 'lint/listed-view-code.json'), 'utf8');
/** @type {Record<string,{path:string, name?:string, reason:string, decision:string}[]>} */
const views = JSON.parse(viewText).shards;
for (const [shard, rows] of Object.entries(views)) for (const row of rows) {
  add('listed-view', lineOf(viewText, `"${row.path}"`), row.name === undefined ? row.path : `${row.path}#${row.name}`, { verdict: 'silly', decision: row.decision, users: [shard], note: `listed view code: ${row.reason}` }, RANK.listedView);
}

// Merge rows that share a key: the higher-ranked row wins and keeps every source line.
/** @type {Map<string, Draft>} */
const byKey = new Map();
/** @type {{key:string, kept:string, merged:string[]}[]} */
const merged = [];
for (const draft of drafts) {
  const seen = byKey.get(draft.key);
  if (seen === undefined) { byKey.set(draft.key, draft); continue; }
  const [win, lose] = draft.rank > seen.rank ? [draft, seen] : [seen, draft];
  byKey.set(draft.key, { ...win, from: [...seen.from, ...draft.from] });
  const note = merged.find(row => row.key === draft.key) ?? (merged.push({ key: draft.key, kept: '', merged: [] }), merged[merged.length - 1]);
  if (note === undefined) throw new Error('unreachable');
  note.kept = `${win.verdict} ${win.decision}`;
  note.merged.push(`${lose.verdict} ${lose.decision} (${lose.from.map(from => `${from.source}:${from.line}`).join(', ')})`);
}

// The decision ids a row may cite: every G row of singleplayer's decisions.md at the pin, every J row of meta's §2.
const decisionsText = show(singleplayer, SINGLEPLAYER_SHA, 'docs/plans/decisions.md');
const gIds = [...new Set([...decisionsText.matchAll(/^\| *(G\d+) *\|/gmu)].map(match => match[1] ?? ''))];
const metaText = show(meta, META_SHA, META_PLAN), section = metaText.slice(metaText.indexOf('\n## 2. '), metaText.indexOf('\n## 3. '));
const jIds = [...new Set([...section.matchAll(/^\| *(J\d+) *\|/gmu)].map(match => match[1] ?? ''))];

/** A row in the register's field order, without its merge rank. @param {Draft} row */
function written(row) {
  /** @type {Record<string, unknown>} */
  const out = { key: row.key, verdict: row.verdict, decision: row.decision, users: row.users };
  if (row.recheck !== undefined) out.recheck = row.recheck;
  if (row.score !== undefined) out.score = row.score;
  out.from = row.from;
  if (row.note !== undefined) out.note = row.note;
  return out;
}
const register = {
  schema: 'wildshard.host-register/1',
  about: 'HOST-RULER HR5: one row per host module or module#binding. Verdicts engine and game are platform; pending and borderline charge back after recheck; silly is charged to its users. Bar: docs/HOST-BAR.md. Reader: scripts/host-ruler/register.mjs.',
  decisions: {
    G: { source: `wildshard-singleplayer@${SINGLEPLAYER_SHA} docs/plans/decisions.md`, ids: gIds },
    J: { source: `project-wildshard-meta@${META_SHA} ${META_PLAN} section 2`, ids: jIds },
  },
  sources: {
    'pending-users': { file: `engine@${engineSha} lint/platform-pending-users.json`, rows: counts['pending-users'] ?? 0 },
    'host-bar': { file: `wildshard-singleplayer@${SINGLEPLAYER_SHA} docs/HOST-BAR.md`, rows: counts['host-bar'] ?? 0 },
    chargebacks: { file: `engine@${engineSha} scripts/platform-chargebacks.mjs`, rows: counts.chargebacks ?? 0 },
    'host-reviews': { file: `engine@${engineSha} lint/host-reviews.json`, rows: counts['host-reviews'] ?? 0 },
    'listed-view': { file: `engine@${engineSha} lint/listed-view-code.json`, rows: counts['listed-view'] ?? 0 },
  },
  merged: merged.sort((a, b) => a.key.localeCompare(b.key)),
  dropped,
  rows: [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)).map(written),
};
const text = formatRegister(register), file = join(ENGINE_ROOT, REGISTER);
if (args.includes('--write')) writeFileSync(file, text);
else if (readFileSync(file, 'utf8') !== text) { console.error(`register-migrate: ${REGISTER} differs from the old lists; rerun with --write`); process.exit(1); }
const read = readHostRegister(ENGINE_ROOT);
/** @type {Record<string, number>} */
const verdicts = {};
for (const row of read.rows) verdicts[row.verdict] = (verdicts[row.verdict] ?? 0) + 1;
console.log(JSON.stringify({ rows: read.rows.length, verdicts, sources: counts, merged: merged.length, dropped: dropped.length }));
