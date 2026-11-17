/**
 * ONE-FORMAT OF10: the gate ledger. A gate is engine code that treats one shard differently from another by where it
 * came from (the provenance option, `FolderOptions`' own-shard flag) or by a capability only our shards may declare,
 * instead of by its data and budget. Every reference to that flag in engine `src/` (OF1's `engine.access-gate-references`) belongs to exactly one
 * gate here, counted per file; a gate with no flag reference names its line by an exact snippet.
 * `test/gate-ledger.test.ts` fails when a reference or a snippet is not in the ledger, and when `docs/GATES.md` is stale;
 * `node scripts/gates-doc.mjs` regenerates the doc (and shard-format's copy).
 *
 * Verdicts: **delete** gates are not dangerous: OF10a deletes them with the provenance option, and our shards load
 * exactly like an upload. **dangerous** gates guard a real harm: OF10b renames each to its `name`, and OF10c replaces it
 * with the budget tier named in `budget`, then deletes it. Erasable TypeScript only: `scripts/gates-doc.mjs` imports it.
 */

export type GateVerdict = 'delete' | 'dangerous';

export interface Gate {
  readonly id: string;
  readonly verdict: GateVerdict;
  /** What the gate does today. */
  readonly what: string;
  /** Delete gates: what replaces it when it goes. */
  readonly replacedBy?: string;
  /** Dangerous gates: the `dangerousX` name OF10b gives it. */
  readonly name?: string;
  /** Dangerous gates: what an upload could do if the gate were simply opened. */
  readonly harm?: string;
  /** Dangerous gates: the budget tier (OF10c) that replaces it. */
  readonly budget?: string;
  /** Provenance-flag references per engine file (path from the engine root). */
  readonly refs?: Readonly<Record<string, number>>;
  /** Lines with no flag reference, each an exact snippet found in its file. */
  readonly snippets?: readonly { readonly file: string; readonly text: string }[];
}

const FOLDER = 'src/client/game/shardfile/folder.ts';
const RUNTIME_FOLDER = 'src/client/game/shardfile/runtimeFolder.ts';
const CLIENT_SOURCE = 'src/client/game/shardfile/clientSource.ts';
// OF15 renames this file; until then its path is the one place the ledger names the retired word.
const PLAN_PAGE = 'src/client/game/shardfile/hybrid.ts';
const DESCRIPTOR = 'src/shared/game/shardfile/outputDescriptor.ts';
const GRID_FOLDERS = 'src/client/game/grid/folders.ts';
/** OF10b: each dangerous gate is one deprecated function here; its sites call it by name. */
export const DANGEROUS_GATES = 'src/shared/game/shardfile/dangerousGates.ts';

export const GATES: readonly Gate[] = [
  {
    id: 'provenance-flag', verdict: 'delete',
    what: 'The provenance option itself: its field on `FolderOptions` and on a client-plan resident, '
      + '`browserShardfileOptions`\'s argument, and the literal `true` our client-plan shards, the grid prefetch and the server pass.',
    replacedBy: 'Nothing: with every other gate gone the option carries no meaning, so it goes (OF10a).',
    refs: { [FOLDER]: 4, [RUNTIME_FOLDER]: 2, [PLAN_PAGE]: 3, [DESCRIPTOR]: 1, [CLIENT_SOURCE]: 1, [DANGEROUS_GATES]: 1,
      'src/server/host/standalone/serverFolder.ts': 1, 'src/client/game/grid/prefetchIndexCore.ts': 1,
      'src/client/game/grid/regionalRuntime.ts': 1, 'src/client/game/shard/declaredEntry.ts': 1 },
  },
  {
    id: 'built-receipt', verdict: 'delete',
    what: 'Our own product skips per-file schema checks on its build\'s validation receipt (built indexes, '
      + '`isBuildValidatedOutput`, `builtValidationReceipt`, built JSON); an upload is checked file by file.',
    replacedBy: 'Every shard takes the upload\'s checks; a check result may be cached by content hash (bundling only as a cache).',
    refs: { [FOLDER]: 5, [DESCRIPTOR]: 5, [RUNTIME_FOLDER]: 3, [GRID_FOLDERS]: 1 },
  },
  {
    id: 'native-read', verdict: 'delete',
    what: 'Our own product reads its files with direct and range fetches, paced section parses and pinned transport, '
      + 'instead of the shared folder reads an upload uses.',
    replacedBy: 'One read path for every shard, from the CDN with the same admission.',
    refs: { [FOLDER]: 6, [RUNTIME_FOLDER]: 2, [GRID_FOLDERS]: 2, [DESCRIPTOR]: 2 },
  },
  {
    id: 'cache-provenance', verdict: 'delete',
    what: 'The visited-folder cache records provenance: an external page uses the browser folder cache and our own '
      + 'does not, and offline our own page refuses an entry an external page wrote.',
    replacedBy: 'One cache keyed by content hash; provenance is not recorded.',
    refs: { [FOLDER]: 14, [RUNTIME_FOLDER]: 4, 'src/client/game/shardfile/legacyAsset.ts': 2 },
  },
  {
    id: 'identity', verdict: 'delete',
    what: 'An outside shard may not take one of our reserved slugs, and must carry its admitted save instance; ours '
      + 'derive theirs from the slug.',
    replacedBy: 'Identity and the save instance come from admission for every shard; the api-server owns slugs per account '
      + '(check it refuses another account\'s slug before OF10a deletes the reserved list).',
    refs: { [FOLDER]: 1, [CLIENT_SOURCE]: 2 },
  },
  {
    id: 'catalogue-manifest', verdict: 'delete',
    what: 'The built-in catalogue path: a manifest\'s `shardfile` descriptor needs our own provenance, and selection '
      + 'keeps the other catalogue shards only for our own source.',
    replacedBy: 'The catalogue lists uploads; a selected shard is admitted like any upload.',
    refs: { [CLIENT_SOURCE]: 5 },
  },
  {
    id: 'runtime-admission', verdict: 'dangerous', name: 'dangerousUnbudgetedRuntime',
    what: 'A shard that declares a `runtime` is admitted only as our own (`folder.ts`, inline arrival, and the data-only '
      + 'source paths that refuse any runtime).',
    harm: 'A runtime binds a native module compiled into the engine bundle (one shard\'s TypeScript), which runs with no CPU, '
      + 'memory or bandwidth limit of its own.',
    budget: 'OF10c: the shard\'s tier CPU and memory limits, metered on the runtime\'s module.',
    refs: { [DANGEROUS_GATES]: 1 },
    snippets: [
      { file: FOLDER, text: 'if (source.runtime !== null && !dangerousUnbudgetedRuntime(options)) throw' },
      { file: CLIENT_SOURCE, text: 'if (!dangerousUnbudgetedRuntime(options)) throw' },
      { file: CLIENT_SOURCE, text: "if (admitted.source.runtime !== null) throw new Error('Custom runtime requires" },
      { file: CLIENT_SOURCE, text: "  if (source.runtime !== null) throw new Error('Custom runtime requires" },
    ],
  },
  {
    id: 'declared-page', verdict: 'dangerous', name: 'dangerousUnbudgetedPageFeatures',
    what: 'A shard with a declared client page (native page features) is admitted only as our own.',
    harm: 'Native page features run engine page code paths the shard selects (stages, owners, plan features), outside the '
      + 'cost its admission charged.',
    budget: 'OF10c: the shard\'s tier CPU and memory limits, charged per page feature.',
    refs: { [DANGEROUS_GATES]: 1 },
    snippets: [{ file: FOLDER, text: 'if (hasDeclaredClientPage(source) && !dangerousUnbudgetedPageFeatures(options)) throw' }],
  },
  {
    id: 'runtime-ownership', verdict: 'dangerous', name: 'dangerousRuntimeOwnership',
    what: 'Only our own runtime may own the page\'s world, audio or stages, run an empty client-plan policy, or keep a '
      + 'data resident (`clientSource.ts` bindings and the client-plan page module).',
    harm: 'An owning runtime replaces the engine\'s admitted world, audio or stage owners, so its frame and memory cost '
      + 'escape admission entirely.',
    budget: 'OF10c: the shard\'s tier CPU and memory limits, with the owned stages metered as the runtime\'s.',
    refs: { [DANGEROUS_GATES]: 1 },
    snippets: [
      { file: CLIENT_SOURCE, text: "=== true && (!dangerousRuntimeOwnership(options)" },
      { file: CLIENT_SOURCE, text: "if (bindings.audioOwner === 'runtime' && (!dangerousRuntimeOwnership(options)" },
      { file: CLIENT_SOURCE, text: "if (bindings.worldOwner === 'runtime' && (!dangerousRuntimeOwnership(options)" },
      { file: PLAN_PAGE, text: "if (bindings.stagesOwner === 'runtime' && !dangerousRuntimeOwnership(options)) throw" },
      { file: PLAN_PAGE, text: 'preparePageRuntime(product, dangerousRuntimeOwnership(folderOptions))' },
      { file: PLAN_PAGE, text: 'if (!dangerousRuntimeOwnership(resident) ||' },
    ],
  },
  {
    id: 'graph-authority', verdict: 'dangerous', name: 'dangerousUnbudgetedMaterialGraph',
    what: 'Material graphs keep their declared ceilings only for a shard with a runtime or a declared page; any other '
      + 'shard\'s graphs are clamped.',
    harm: 'Opened, any shard could compile unbounded GPU shader graphs (nodes, samplers, passes) on every player\'s device.',
    budget: 'OF10c: the shard\'s tier GPU limits (graph nodes, textures, passes).',
    snippets: [{ file: DANGEROUS_GATES, text: 'export function dangerousUnbudgetedMaterialGraph(' },
      { file: 'src/client/game/grid/session.ts', text: 'trustedGraphs: dangerousUnbudgetedMaterialGraph(source)' }],
  },
];

/** Lines the OF10 audit named that are not gates: they treat every shard alike. */
export const NOT_GATES: readonly string[] = [
  'Server-class files (shard-format `outputIndex.ts`, J91): an admission class every product may use; not provenance.',
  '`hasDeclaredClientPage` branches in `clientSource.ts`, `client.ts`, `clientPlan.ts`, `clientGround.ts` and '
    + '`regionalRuntime.ts`: they follow the shard\'s data once it is admitted; only the admission refusal is a gate (declared-page).',
  '`runtime !== null` in the headless proofs (`checkShardfile.ts`, `headless.ts`, `simulation.ts`): author tooling, not admission.',
];

/** The ledger as `docs/GATES.md` (engine) and shard-format `docs/GATES.md`. */
export function renderGates(gates: readonly Gate[] = GATES): string {
  const dangerous = gates.filter(gate => gate.verdict === 'dangerous'), removed = gates.filter(gate => gate.verdict === 'delete');
  const refs = (gate: Gate): number => Object.values(gate.refs ?? {}).reduce((sum, count) => sum + count, 0);
  // counts, not paths: engine's ledger names the files (a path may still carry a word OF15 retires)
  const sites = (gate: Gate): string => [refs(gate) === 0 ? '' : `${refs(gate)} references in ${Object.keys(gate.refs ?? {}).length} files`,
    gate.snippets === undefined ? '' : `${gate.snippets.length} named lines`].filter(row => row !== '').join(', ');
  const lines = [
    '# Gates',
    '',
    '> Generated by engine `scripts/gates-doc.mjs` from `src/shared/game/shardfile/gates.ts` (ONE-FORMAT OF10), which names',
    '> each gate\'s files. Do not edit.',
    '',
    'A gate is engine code that treats one shard differently from another by where it came from, not by its data and budget.',
    '**delete** gates are not dangerous and go with the provenance option (OF10a). **dangerous** gates are renamed',
    '`dangerousX` (OF10b) and replaced by a budget tier (OF10c).',
    '',
    `${gates.length} gates: ${removed.length} delete (${removed.reduce((sum, gate) => sum + refs(gate), 0)} provenance references), `
      + `${dangerous.length} dangerous (${dangerous.reduce((sum, gate) => sum + refs(gate), 0)}).`,
    '',
    '| Gate | Verdict | What it does | Harm | Replaced by | Where |',
    '|---|---|---|---|---|---|',
    ...gates.map(gate => `| ${gate.id}${gate.name === undefined ? '' : ` (\`${gate.name}\`)`} | ${gate.verdict} | ${gate.what} | `
      + `${gate.harm ?? 'none'} | ${gate.verdict === 'dangerous' ? gate.budget ?? '' : gate.replacedBy ?? ''} | ${sites(gate)} |`),
    '',
    '## Not gates',
    '',
    ...NOT_GATES.map(row => `- ${row}`),
    '',
  ];
  return lines.join('\n');
}
