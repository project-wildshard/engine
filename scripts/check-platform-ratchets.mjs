// SF1b: immutable predecessor lists, never the candidate's own allowance, set the limit.
import { compareCoupling, compareWeaponTransfers, WEAPON_TRANSFER_BOOTSTRAP, WEAPON_TRANSFER_LIST, CLASS_MOVE_LIST, classMoveSites } from './shard-coupling.mjs';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimePerformanceSites } from '../lint/runtime-performance.mjs';
import { compareRuntimeFiles, RUNTIME_FILES_LIST } from '../lint/runtime-files.mjs';
import { zeroPolicyFailures } from './check-custom-sections-zero.mjs';
import { SIDE_EDGES_LIST, compareSideEdges } from '../lint/engine-sides.mjs';

export const PLATFORM_LISTS = ['lint/row-functions.json', 'lint/edge-exemptions.json', 'lint/shard-platform.json', 'lint/ratchet.json', 'lint/sim-closure.json', 'lint/sim-schema-leaves.json', 'lint/shard-coupling.json', WEAPON_TRANSFER_LIST, CLASS_MOVE_LIST, 'lint/runtime-performance.json', RUNTIME_FILES_LIST, SIDE_EDGES_LIST];

const RUNTIME_REKEY_ABOUT = 'SF62 reviewed transition debt. Re-key an edited or moved function only to a lint-confirmed site by retiring real predecessor allowance of the same kind and row; total count per kind and row never grows. Deleted sites drop; no new allowances.';

// Consume removed predecessor syntax once, across all destinations. Immutable source trees establish
// whether an implementation actually moved; neither the new allowance nor a review label can grant debt.
function siteCounts(source, filename) {
  const counts = new Map();
  for (const site of runtimePerformanceSites(source, filename)) {
    if (site.kind === 'syntax') continue;
    const key = `${site.kind}:${site.site}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
function removedPlatformSites(baselineRoot, candidateRoot) {
  const removed = new Map();
  const walk = dir => {
    if (!existsSync(join(baselineRoot, dir))) return;
    for (const entry of readdirSync(join(baselineRoot, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile() || !file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
      const before = readFileSync(join(baselineRoot, file), 'utf8'), next = join(candidateRoot, file);
      const after = existsSync(next) ? readFileSync(next, 'utf8') : '';
      if (before === after) continue;
      const remaining = siteCounts(after, file);
      for (const [key, count] of siteCounts(before, file)) {
        const gone = count - (remaining.get(key) ?? 0);
        if (gone > 0) removed.set(key, (removed.get(key) ?? 0) + gone);
      }
    }
  };
  for (const layer of ['game', 'sdk', 'sharddev', 'engine']) walk(`src/${layer}`);
  return removed;
}
function verbatimRuntimeMoves(before, after, trees) {
  const admitted = new Set();
  if (trees === undefined) return admitted;
  const newSites = Object.entries(after.sites).filter(([key]) => !Object.hasOwn(before.sites, key));
  if (newSites.length === 0) return admitted;
  const removed = removedPlatformSites(trees.baselineRoot, trees.candidateRoot), targets = new Map();
  for (const [site, item] of newSites) {
    const match = /^(src\/shards\/[^/]+\/[^:]+\.ts):([^:]+):([a-f0-9]{64})$/u.exec(site);
    if (match === null || !Number.isSafeInteger(item.count) || item.count <= 0) continue;
    const [, file, rule, hash] = match, key = `${rule}:${hash}`, target = join(trees.candidateRoot, file);
    if (file.split('/').includes('..')) continue;
    if (!existsSync(target)) continue;
    if (!targets.has(file)) targets.set(file, siteCounts(readFileSync(target, 'utf8'), file));
    if ((targets.get(file).get(key) ?? 0) < item.count || (removed.get(key) ?? 0) < item.count) continue;
    removed.set(key, removed.get(key) - item.count);
    admitted.add(site);
  }
  return admitted;
}

// Re-key edited/moved functions only by spending removed, real predecessor sites.
// Neither another kind nor another plan row can fund a replacement.
function rekeyedRuntimeSites(before, after, trees) {
  const admitted = new Set();
  if (trees === undefined) return admitted;
  const counts = new Map(), credit = new Map();
  const actual = (root, site) => {
    const match = /^(src\/[^:]+\.ts):([^:]+):([a-f0-9]{64})$/u.exec(site);
    if (match === null || match[1].split('/').includes('..')) return 0;
    const [, file, kind, hash] = match, path = join(root, file);
    if (!existsSync(path)) return 0;
    if (!counts.has(path)) counts.set(path, siteCounts(readFileSync(path, 'utf8'), file));
    return counts.get(path).get(`${kind}:${hash}`) ?? 0;
  };
  const group = (site, item) => JSON.stringify([site.split(':')[1], item.row]);
  for (const [site, item] of Object.entries(before.sites)) {
    const retained = after.sites[site]?.row === item.row ? after.sites[site].count : 0;
    const removed = Math.min(item.count, actual(trees.baselineRoot, site)) - retained;
    if (removed > 0) credit.set(group(site, item), (credit.get(group(site, item)) ?? 0) + removed);
  }
  for (const [site, item] of Object.entries(after.sites)) {
    if (Object.hasOwn(before.sites, site)) continue;
    const key = group(site, item), available = credit.get(key) ?? 0;
    if (!Number.isSafeInteger(item.count) || item.count <= 0 || actual(trees.candidateRoot, site) !== item.count || available < item.count) continue;
    credit.set(key, available - item.count); admitted.add(site);
  }
  return admitted;
}

// Retiring an exact relocation stops discounting that existing class. It cannot fund any
// new/changed inheritance: compare the whole shard's resolved class roster in immutable trees.
function retiredClassCeilings(trees) {
  const credit = {};
  if (trees === undefined) return credit;
  const readMoves = root => {
    const file = join(root, CLASS_MOVE_LIST);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).moves : {};
  };
  const before = readMoves(trees.baselineRoot), after = readMoves(trees.candidateRoot);
  // A descendant still resolves to the same moved file after its exact record
  // retires. Compare both complete rosters using that proven file identity;
  // changed imports, heritage and additional classes still change the roster.
  const ancestryMoves = { ...before, ...after };
  const normalized = site => ({ name: site.name, heritage: site.heritage,
    baseFile: Object.values(ancestryMoves).find(move => move.to === site.baseFile)?.from ?? site.baseFile });
  const roster = (root, slug) => {
    const rows = {};
    const walk = directory => {
      if (!existsSync(join(root, directory))) return;
      for (const item of readdirSync(join(root, directory), { withFileTypes: true })) {
        const file = `${directory}/${item.name}`;
        if (item.isDirectory()) walk(file);
        else if (item.isFile() && /\.tsx?$/u.test(file) && !file.endsWith('.d.ts')) {
          const sites = classMoveSites(readFileSync(join(root, file), 'utf8'), file, root).filter(site => site.heritage.length > 0);
          if (sites.length > 0) rows[file] = sites.map(site => normalized(site));
        }
      }
    };
    walk(`src/shards/${slug}`);
    return JSON.stringify(Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b))));
  };
  const unchanged = new Map();
  for (const [key, move] of Object.entries(before)) {
    if (Object.hasOwn(after, key) || move.name === '<anonymous>' || move.base !== 'Weapon' || key !== `${move.to}:${move.hash}`) continue;
    const match = /^src\/shards\/([^/]+)\/runtime\/[^:]+\.ts$/u.exec(move.to);
    if (match === null || move.to.split('/').includes('..')) continue;
    const slug = match[1], originalFile = join(trees.baselineRoot, move.to), nextFile = join(trees.candidateRoot, move.to);
    if (!existsSync(originalFile) || !existsSync(nextFile)) continue;
    const original = classMoveSites(readFileSync(originalFile, 'utf8'), move.to, trees.baselineRoot).filter(site => site.hash === move.hash && site.name === move.name);
    const next = classMoveSites(readFileSync(nextFile, 'utf8'), move.to, trees.candidateRoot).filter(site => site.name === move.name);
    if (original.length !== 1 || next.length !== 1 || next[0].hash === move.hash || normalized(original[0]).baseFile !== move.baseFile ||
      JSON.stringify(normalized(original[0])) !== JSON.stringify(normalized(next[0]))) continue;
    if (!unchanged.has(slug)) unchanged.set(slug, roster(trees.baselineRoot, slug) === roster(trees.candidateRoot, slug));
    if (!unchanged.get(slug)) continue;
    const row = credit[slug] ??= { engineSubclasses: 0, 'subclass.Weapon': 0 };
    row.engineSubclasses++; row['subclass.Weapon']++;
  }
  return credit;
}

/** Explicit immutable trees permit proven verbatim moves; every other policy allowance remains shrink-only.
 * Immutable source readers retain the same shrink-only checks without retired custom-policy inputs. */
export function comparePlatformList(list, baselineFile, candidateFile, trees, sources) {
  if (list === 'lint/ratchet.json') {
    const read=file=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):undefined;
    const fromSource=reader=>{const text=reader('lint/ratchet.json');return text===undefined?undefined:JSON.parse(text);};
    const after=sources===undefined?read(candidateFile):fromSource(sources.after);
    return zeroPolicyFailures(after?.budgets??{});
  }
  if (list === SIDE_EDGES_LIST) {
    // P1-E2: the engine-side edge counts only fall; the first commit seeds them.
    const read = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
    return compareSideEdges(read(baselineFile), read(candidateFile));
  }
  if (list === CLASS_MOVE_LIST) {
    const before = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')).moves : {};
    if (!existsSync(candidateFile)) return Object.keys(before).length > 0 ? [`${list}: class move records removed`] : [];
    const after = JSON.parse(readFileSync(candidateFile, 'utf8')), failures = [], consumed = new Map();
    if (after.version !== 1 || Object.keys(after).sort().join(',') !== 'moves,version') return [`${list}: invalid shape`];
    for (const [key, move] of Object.entries(after.moves)) {
      if (before[key] !== undefined) {
        if (JSON.stringify(before[key]) !== JSON.stringify(move)) failures.push(`${list}: immutable move changed ${key}`);
        continue;
      }
      if (trees === undefined || Object.keys(move).sort().join(',') !== 'base,baseFile,from,hash,name,to'
        || !/^src\/(?:game|sdk|sharddev|engine)\/[^.][^:]*\.ts$/u.test(move.from) || move.from.split('/').includes('..')
        || !/^src\/shards\/[^/]+\/runtime\/[^:]+\.ts$/u.test(move.to) || move.to.split('/').includes('..')
        || key !== `${move.to}:${move.hash}` || !/^[a-f0-9]{64}$/u.test(move.hash)) { failures.push(`${list}: unproved move ${key}`); continue; }
      const source = join(trees.baselineRoot, move.from), target = join(trees.candidateRoot, move.to);
      if (!existsSync(source) || existsSync(join(trees.candidateRoot, move.from)) || !existsSync(target)) { failures.push(`${list}: source not retired ${key}`); continue; }
      const matches = (path, file, root, original) => classMoveSites(readFileSync(path, 'utf8'), file, root).filter(site => {
        const baseFile = original ? site.baseFile : Object.values(after.moves).find(item => item.to === site.baseFile)?.from ?? site.baseFile;
        return site.hash === move.hash && site.name === move.name && baseFile === move.baseFile && baseFile !== null;
      }).length;
      const original = matches(source, move.from, trees.baselineRoot, true), current = matches(target, move.to, trees.candidateRoot, false), sourceKey = `${move.from}:${move.hash}`;
      const used = (consumed.get(sourceKey) ?? 0) + 1; consumed.set(sourceKey, used);
      if (original < used || current !== 1) failures.push(`${list}: class body changed or copied ${key}`);
    }
    return failures;
  }
  if (list === RUNTIME_FILES_LIST) {
    // Shrink-only per-shard runtime/ file ceilings: a rise needs a new raises line (lint/runtime-files.mjs).
    if (!existsSync(candidateFile)) return existsSync(baselineFile) ? [`${list}: ceiling list removed`] : [];
    return compareRuntimeFiles(existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : undefined, JSON.parse(readFileSync(candidateFile, 'utf8')));
  }

  if (list === WEAPON_TRANSFER_LIST) {
    if (!existsSync(candidateFile)) return existsSync(baselineFile) ? [`${list}: transfer policy was removed; retire its entries instead`] : [];
    const before = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')).transfers : WEAPON_TRANSFER_BOOTSTRAP;
    return compareWeaponTransfers(before, JSON.parse(readFileSync(candidateFile, 'utf8')).transfers);
  }
  if (list === 'lint/runtime-performance.json') {
    if (!existsSync(candidateFile)) return [`${list}: reviewed policy was removed; retire its sites instead`];
    const after = JSON.parse(readFileSync(candidateFile, 'utf8'));
    if (!existsSync(baselineFile)) {
      // E435 / SF62: coordinator-reviewed bootstrap, 441 exact sites / 626 violations; never a new-site escape.
      const digest = createHash('sha256').update(JSON.stringify(after.sites)).digest('hex');
      return digest === '77308f0fdfbbb38ae8d19cd97d5d9940a396fd1f16edf1a009ef878f5aace0de' && after.baselineAt === 'fadcee06196f345f706aa9f7e01a3bb027968a20' ? [] : [`${list}: bootstrap differs from the reviewed inventory`];
    }
    const before = JSON.parse(readFileSync(baselineFile, 'utf8')), failures = [];
    const totals = sites => {
      const result = new Map();
      for (const [site, item] of Object.entries(sites)) {
        const key = JSON.stringify([site.split(':')[1], item.row]);
        result.set(key, (result.get(key) ?? 0) + item.count);
      }
      return result;
    };
    // Newly visible debt is paid by exact syntax consumed from engine/game/SDK,
    // not by a review label. Charge ordinary sites to the existing row ceilings.
    const migrated = verbatimRuntimeMoves(before, after, trees);
    const charged = Object.fromEntries(Object.entries(after.sites).filter(([site]) => !migrated.has(site)));
    const ceilings = totals(before.sites);
    for (const [key, count] of totals(charged)) if (count > (ceilings.get(key) ?? 0)) failures.push(`${list}: ${key} total rose`);
    for (const site of rekeyedRuntimeSites(before, after, trees)) migrated.add(site);
    if (after.baselineAt !== before.baselineAt || (after.about !== before.about && after.about !== RUNTIME_REKEY_ABOUT) || Object.keys(after).sort().join(',') !== Object.keys(before).sort().join(',')) failures.push(`${list}: review metadata changed`);
    for (const [site, item] of Object.entries(after.sites)) {
      const previous = before.sites[site];
      if (!previous) { if (!migrated.has(site)) failures.push(`${list}: new runtime site ${site}`); }
      else {
        if (item.count > previous.count) failures.push(`${list}: ${site} count rose`);
        if (item.row !== previous.row) failures.push(`${list}: ${site} retirement owner changed`);
      }
      if (!Number.isSafeInteger(item.count) || item.count <= 0 || Object.keys(item).sort().join(',') !== 'count,row') failures.push(`${list}: invalid site ${site}`);
    }
    return failures;
  }
  const before = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const after = JSON.parse(readFileSync(candidateFile, 'utf8'));
  const failures = [];
  if (list === 'lint/row-functions.json') {
    for (const field of after.fields) if (!before.fields.includes(field)) failures.push(`${list}: new function allowance ${field}`);
  } else if (list === 'lint/edge-exemptions.json') {
    for (const slug of Object.keys(after.levels)) if (!Object.hasOwn(before.levels, slug)) failures.push(`${list}: new edge exemption ${slug}`);
  } else if (list === 'lint/shard-platform.json') {
    // G291 changes the measured conversion ratio, not these historical no-copy policies.
    // G291/G294 is report-only until reviewed; never rewrite or relax the predecessor baselines.
    for (const [slug, lines] of Object.entries(before.baseline)) {
      if (after.baseline[slug] !== lines) failures.push(`${list}: ${slug} baseline must stay ${lines}`);
    }
    for (const [slug, lines] of Object.entries(after.baseline)) {
      if (!Object.hasOwn(before.baseline, slug) && !['thin-ice', 'blender-template', 'pastel-plain', 'ink-cel-valley', 'open-plots'].includes(slug)) failures.push(`${list}: unknown shard ${slug}`);
      if (!Number.isSafeInteger(lines) || lines <= 0) failures.push(`${list}: invalid baseline for ${slug}`);
      if (['blender-template', 'pastel-plain', 'ink-cel-valley', 'open-plots'].includes(slug) && after.enforced[slug] !== 0) failures.push(`${list}: ${slug} needs its zero runtime ceiling from its first commit`);
      if (slug === 'thin-ice' && !Object.hasOwn(after.enforced, slug)) failures.push(`${list}: thin-ice needs its 20 % ceiling from its first commit`);
    }
    for (const [slug, ceiling] of Object.entries(before.enforced)) {
      if (!Object.hasOwn(after.enforced, slug) || after.enforced[slug] > ceiling) failures.push(`${list}: ${slug} ceiling rose or was removed (was ${ceiling})`);
    }
    for (const [slug, ceiling] of Object.entries(after.enforced)) {
      if (!Object.hasOwn(after.baseline, slug)) failures.push(`${list}: unknown enforced shard ${slug}`);
      if (!Number.isSafeInteger(ceiling) || ceiling < 0 || ceiling > Math.floor(after.baseline[slug] * 0.2)) failures.push(`${list}: ${slug} ceiling exceeds 20 % of its baseline`);
    }
  } else if (list === 'lint/shard-coupling.json') {
    const retired = retiredClassCeilings(trees), baseline = structuredClone(before.shards);
    for (const [slug, counts] of Object.entries(retired)) for (const [metric, count] of Object.entries(counts)) {
      if (baseline[slug] !== undefined) baseline[slug].counts[metric] = (baseline[slug].counts[metric] ?? 0) + count;
    }
    failures.push(...compareCoupling(baseline, after.shards).map((failure) => `${list}: ${failure}`));
  } else if (list === 'lint/sim-schema-leaves.json') {
    for (const [path, item] of Object.entries(after)) {
      const previous = before[path];
      if (!previous) failures.push(`${list}: new schema leaf ${path}`);
      else if (Object.keys(item).length !== Object.keys(previous).length || Object.entries(item).some(([key, value]) => value !== previous[key])) failures.push(`${list}: ${path} review or removal owner changed`);
    }
  } else if (list === 'lint/sim-closure.json') {
    for (const [site, item] of Object.entries(after.violations)) {
      const previous = before.violations[site];
      if (!previous) failures.push(`${list}: new sim site ${site}`);
      else {
        if (item.count > previous.count) failures.push(`${list}: ${site} count rose ${previous.count} → ${item.count}`);
        if (item.row !== previous.row) failures.push(`${list}: ${site} owner changed ${previous.row} → ${item.row}`);
      }
      if (!Number.isSafeInteger(item.count) || item.count <= 0) failures.push(`${list}: invalid count for ${site}`);
    }
  } else throw new Error(`Unknown platform list ${list}`);
  return failures;
}

export function checkPlatformRatchets(baselineRoot, candidateRoot) {
  return [...new Set(PLATFORM_LISTS.flatMap((list) => comparePlatformList(list, resolve(baselineRoot, list), resolve(candidateRoot, list), { baselineRoot, candidateRoot })))];
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [baseline, candidate] = process.argv.slice(2);
  if (!baseline || !candidate) throw new Error('Usage: check-platform-ratchets.mjs <baseline-root> <candidate-root>');
  const failures = checkPlatformRatchets(baseline, candidate);
  for (const failure of failures) console.error(failure);
  process.exitCode = failures.length > 0 ? 1 : 0;
}
