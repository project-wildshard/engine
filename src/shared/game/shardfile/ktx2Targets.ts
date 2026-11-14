/** S11 (meta `docs/plans/SENTRY-TRIAGE-PLAN.md`): a product's KTX2 table (`discovery.json` `native.ktx2`: a plain
 *  `GPU_FILES` table or `pageModeKtx2` rows, shard and grid, phone and desktop) maps a source URL to the file a GPU tier
 *  loads instead. A target the product does not carry 404s on every host that serves the page, and a phone that needs that
 *  texture never finishes entering (Pine Hollow rev 1, Nine Dragon). Admission refuses such a product, naming the first
 *  missing target in the table's own order.
 *
 *  A target is served when it is a file under `mounts/`, a `cook.json` mount row over a file the product holds, a product
 *  file at `/shardfiles/<slug>/<path>`, or an engine file: the caller says which URLs its host serves itself. A `phone` row's
 *  target is also served when its source is (SHARD-SIZE S12d): the cook makes that phone file from the source, as a shard that
 *  dropped its hand-made phone set (Sky Reach rev 2 on) expects. */

/** Read access to one product: the paths it holds and the bytes of one of them. */
export interface Ktx2TableProduct {
  readonly paths: () => Iterable<string>;
  readonly read: (path: string) => Uint8Array;
}

const DISCOVERY = /^mounts\/shardfiles\/([^/]+)\/discovery\.json$/u;
const isRow = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
function parse(bytes: Uint8Array, path: string): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new Error(`KTX2 table: ${path} is not JSON`); }
}

/** Every target the table names, in document order. A key is a source URL, never a target. Every shape the table takes
 *  (`GPU_FILES`, `pageModeKtx2` args, a bare tier map) holds only tier maps, so a `/`-string value is a target; an argument
 *  that is a `/`-path but no target would need this walk narrowed to the tier maps. */
export function ktx2TableTargets(table: unknown): readonly string[] {
  const targets: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') { if (value.startsWith('/')) targets.push(value); }
    else if (Array.isArray(value)) for (const child of value) walk(child);
    else if (isRow(value)) for (const child of Object.values(value)) walk(child);
  };
  walk(table);
  return targets;
}

/** Each `phone` row's target and the source the cook makes it from when the product lacks it (`phoneTier`, S12d): a row whose
 *  source and target are the same kind of file (GLB or KTX2). */
export function phoneRowSources(table: unknown): ReadonlyMap<string, string> {
  const rows = new Map<string, string>(), kind = (url: string): string | undefined => /\.(glb|ktx2)$/u.exec(url)?.[1];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const child of value) walk(child); return; }
    if (!isRow(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'phone' && isRow(child)) {
        for (const [source, target] of Object.entries(child)) if (typeof target === 'string' && kind(target) !== undefined && kind(source) === kind(target) && !rows.has(target)) rows.set(target, source);
      } else walk(child);
    }
  };
  walk(table);
  return rows;
}

/** The table's targets nothing serves, each once, first missing first. */
export function missingKtx2Targets(product: Ktx2TableProduct, engineFile: (url: string) => boolean = () => false): { readonly total: number; readonly missing: readonly string[] } {
  const paths = new Set(product.paths());
  const discovery = [...paths].find(path => DISCOVERY.test(path));
  if (discovery === undefined) return { total: 0, missing: [] };
  const document = parse(product.read(discovery), discovery);
  const table = isRow(document) && isRow(document['native']) ? document['native']['ktx2'] : undefined, targets = ktx2TableTargets(table);
  if (targets.length === 0) return { total: 0, missing: [] };
  const mounted = new Set<string>();
  if (paths.has('cook.json')) {
    const cook = parse(product.read('cook.json'), 'cook.json');
    const rows: readonly unknown[] = isRow(cook) && Array.isArray(cook['mounts']) ? cook['mounts'] : [];
    for (const row of rows) if (isRow(row) && typeof row['url'] === 'string' && typeof row['path'] === 'string' && paths.has(row['path'])) mounted.add(row['url']);
  }
  const home = `/shardfiles/${DISCOVERY.exec(discovery)?.[1] ?? ''}/`;
  const served = (url: string): boolean => paths.has(`mounts${url}`) || mounted.has(url)
    || (url.startsWith(home) && paths.has(url.slice(home.length))) || engineFile(url);
  const cooked = phoneRowSources(table), made = (url: string): boolean => { const source = cooked.get(url); return source !== undefined && served(source); };
  return { total: targets.length, missing: [...new Set(targets.filter(url => !served(url) && !made(url)))] };
}

/** Refuse a product whose KTX2 table names a file nothing serves. */
export function assertKtx2TableTargets(product: Ktx2TableProduct, engineFile?: (url: string) => boolean): void {
  const { total, missing } = missingKtx2Targets(product, engineFile);
  const [first] = missing;
  if (first !== undefined) throw new Error(`KTX2 table names a missing file: ${first} (${missing.length} of ${total} targets missing)`);
}
