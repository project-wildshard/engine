// G520 / G496: fixture-only growth is still shard code. This is the cut list,
// not an allowance or a budget. A real second shard needs a reviewed re-score.
/** @type {Map<string,import('./shard-components.mjs').Component>} */
const modules = new Map([
  ...['game/boss/arenaScript', 'game/boss/arenaField'].map(path => [`src/${path}.ts`, 'C4']),
  // G530 O1: the seated-figure specimen's one user is Nalati's mounted shepherd (Explorer catalogue)
  ['src/client/game/models/mountedSpecimen.ts', 'C1'],
]);
// G677 credits exact listed entry adapters through g571-hosts, without new
// dispatch-user overrides or duplicate stealth/signal credit. Siblings stay charged.
/** @type {Map<string,Map<string,import('./shard-components.mjs').Component>>} */
// G665 R16: the listed open-arena host (including its boundary) is credited.
const declarations = new Map([
  ['src/client/game/shardfile/worldAssembly.ts', new Map([['installAssemblyArenaScript', 'C9']])],
  ['src/client/game/looks/speciesBook.ts',new Map(['SpeciesLookBook','packedRows'].map(name=>[name,'C1']))],
  ['src/client/game/practice/course.ts', new Map(['MountedCourseEntry', 'GrappleCourseEntry', 'MountEntryRows', 'GrappleEntryRows'].map(name => [name, 'C6']))],
  ['src/client/game/boss/encounterView.ts', new Map(['SlotEncounterView','PatrolEncounterView'].map(name=>[name,'C4']))],
  ['src/shared/game/boss/slotLaw.ts', new Map([['SlotEncounterLaw','C4']])],
  ['src/client/game/shardfile/worldScenes.ts', new Map([['WorldScenePoolPublications', 'C1']])],
  ['src/client/game/shardfile/scenePools.ts', new Map([['WorldSceneTierPools', 'C1']])],
  ['src/format/worldScenes.ts', new Map([['WorldSceneTierPools', 'C1'], ['WorldScenePoolPublications', 'C1']])],
]);

/** Concrete dependencies of the optional chapter facet retain their original
 * users and mixed component attribution; a dispatcher is not another owner.
 * @type {Map<string,readonly string[]|null>} */
const chapterViewNativeOwners = new Map([
  // Remaining unapproved dependencies retain their actual optional-facet consumer.
  // G621 D4/R13 retires the approved figure, equipment and height-patch overrides.
  ["src/client/game/quest/carriedProp.ts", null],
  ["src/client/engine/combat/effects/types.ts", ["SourceMulDef", "anyTag", "sourceMultiplier"]],
]);

// Single-shard branches inside otherwise shared declarations. These spans select
// code lines, never fixed credits; packet/instance-matrix handling stays shared.
/** @type {Map<string,Map<string,[string,number][]>>} */
const inline = new Map([
  // the tier-selected pool decoder the resident scenes and the catalogue's cold intake share
  ['src/client/game/shardfile/scenePools.ts', new Map([['WorldSceneTierPools', [
    ['geometryPools: files.map(file => ({ url: product.url(tierFile(file.file))', 1],
    ['const file = [...files.map(entry => tierFile(entry.file))', 1],
  ]]])],
  ['src/client/game/shardfile/worldScenes.ts', new Map([
    ['WorldScenePoolPublications', [
      ["for (const row of section.libraries) if (row.kind === 'pool' && row.publish !== undefined)", 3],
      ['if (row.publish !== undefined) for (const part of row.files.flatMap', 4],
    ]],
  ])],
  ['src/format/worldScenes.ts', new Map([
    ['WorldScenePoolPublications', [["v.strictObject({ id, kind: v.literal('pool'), publish:", 1]]],
    ['WorldSceneTierPools', [
      ['channels: v.exactOptional(bounded(v.strictObject', 1],
      ['const poolParts = ', 2],
      [": entry.kind === 'pool' ? { ...entry, files: entry.files.filter(active) }", 1],
    ]],
  ])],
]);

/** @param {string} path @param {string} [name] */
function reviewedOwner(path, name) {
  if(path === 'src/client/game/practice/course.ts' && ['GrappleCourseEntry','GrappleEntryRows'].includes(name ?? '')) return 'nine-dragon-stack';
  if (path.endsWith('/worldScenes.ts') || path === 'src/client/game/shardfile/scenePools.ts') return 'nine-dragon-stack';
  return 'nalati-grasslands';
}

/** Shared declarations containing reviewed single-shard branches. */
export function inlinePlatformPaths() { return [...inline.keys()]; }

/** @param {string} path @param {string} source @param {(line:string)=>void} [report]
 * @returns {{name:string,lines:number[]}[]} */
export function inlinePlatformSpans(path, source, report = console.error) {
  const rows = [], lines = source.split('\n'), claimed = new Set();
  for (const [name, blocks] of inline.get(path) ?? []) {
    const selected = [];
    for (const [needle, length] of blocks) {
      const matches = lines.flatMap((line, index) => (needle.startsWith('=') ? line === needle.slice(1) : line.includes(needle)) ? [index] : []);
      if (matches.length !== 1) { report(`shard-platform: skip changed inline span ${path}#${name}: ${needle}`); continue; }
      for (const start of matches) for (let line = start; line < start + length; line++) if (!claimed.has(line)) { claimed.add(line); selected.push(line); }
    }
    rows.push({ name, lines: selected });
  }
  return rows;
}

/** Reviewed sole-user ownership, including declarations hidden behind shared
 * optional dispatch. StaticCapture remains shared.
 * @param {string} path @param {string} [name]
 * @returns {import('./shard-components.mjs').Component|null} */
export function platformChargeback(path, name) {
  return modules.get(path) ?? (name === undefined ? null : declarations.get(path)?.get(name) ?? null);
}
/** @param {string} path */
export function hasChargebackDeclarations(path) { return declarations.has(path); }

/** Whole-module G520 deletions leave no host to receive a pending-user credit.
 * Keep the shared WIP ledger untouched. @param {string} path */
export function retiredPlatformModule(path) {
  return path === 'src/engine/models/glbNodes.ts' || path === 'src/game/shardfile/buildingAssembly.ts';
}

/** A canonical output census can omit an audited host's owning shard.
 * Preserve its owner without indexing a shard outside this measurement.
 * @template {{path:string,lines:number,name?:string}} T
 * @param {Map<string,T[]>} charges @param {string|undefined} owner
 * @param {T} row @param {(line:string)=>void} [report] */
export function recordPrivateCharge(charges, owner, row, report = console.error) {
  // an audited inline branch charges its reviewed owner even inside a declaration another shard shares
  const reviewed = platformChargeback(row.path, row.name) !== null || inline.get(row.path)?.has(row.name ?? '') === true;
  const shard = reviewed ? reviewedOwner(row.path, row.name) : owner;
  const target = charges.get(shard ?? '');
  if (target === undefined) {
    report(`shard-platform: skip ${row.path}${row.name === undefined ? '' : `#${row.name}`}: ${row.lines} lines owned by ${shard ?? 'no user'}, outside measured shards`);
    return false;
  }
  target.push(row);
  return true;
}

/** Reconcile broad import reach with the audited, actual row consumers.
 * @param {Map<string,Set<string>>} moduleUsers
 * @param {Map<string,Set<string>>} bindingUsers */
export function chargePlatformUsers(moduleUsers, bindingUsers) {
  for (const [path, names] of chapterViewNativeOwners) {
    if (names === null) { if (moduleUsers.has(path)) moduleUsers.set(path, new Set(['nalati-grasslands'])); }
    else for (const name of names) { const key = `${path}\0${name}`; if (bindingUsers.has(key)) bindingUsers.set(key, new Set(['nalati-grasslands'])); }
  }
  for (const path of modules.keys()) if (moduleUsers.has(path)) {
    const shard = reviewedOwner(path);
    moduleUsers.set(path, new Set([shard]));
  }
  for (const [path, names] of declarations) for (const name of names.keys()) {
    const key = `${path}\0${name}`;
    if (bindingUsers.has(key)) bindingUsers.set(key, new Set([reviewedOwner(path, name)]));
  }
}
