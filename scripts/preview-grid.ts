// SHARD-AUTHORING SA35 (meta J314, grill Q11; Jake, 2026-11-12: "every deploy of preview in the github actions for deploy borrows the grid
// placement from staging by asking the staging mmo in the github action"). Preview has no MMO: its page bakes `test/pins/catalogue.json`.
// The staging MMO's grid is its build's catalogue (the same pinned J305 cells) plus every cell the API placed since, which it reads from the
// API-signed placement file (SA33, SA33a) at PLACEMENT_URL. Its own `/health` is tailnet-only (D7) and names instances, not cells, so the
// workflow asks for the one file the MMO itself believes, checked under the same placement key, and bakes those cells into preview's page.
//
//   node --import ./scripts/bake-loader.mjs scripts/preview-grid.ts <out.json> [--placements=<url>] [--last=<url>] [--key=<spki hex>]
//        writes the catalogue preview builds (page-release.mjs --catalogue=<out.json>), signature checked by engine's own reader
//   node scripts/preview-grid.ts --news [--placements=<url>] [--last=<url>] [--key=<spki hex>]
//        before install (node built-ins only): `news=true` when staging's placed cells differ from the live preview's
//
// Staging's file missing (404): staging placed no cell, so the pinned grid. Unreadable, refused or a bad signature (the "staging MMO down"):
// the live preview's own borrowed cells stay, and the run says so with a warning. Neither readable: the pinned grid, also with a warning.
import { createPublicKey, verify } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where the API writes staging's placement file (SA33a) and the box reads it (SA33's PLACEMENT_URL). */
export const STAGING_PLACEMENTS = 'https://packs.wildshard.io/releases/staging-placements.json';
/** The live preview's baked catalogue: the last grid, kept when staging can't be read. */
export const LIVE_PREVIEW_CATALOGUE = 'https://preview.wildshard.io/catalogue.json';
/** The API's placement key (SA33a, `~/.config/wildshard/placement-signing-key.pub.pem`), SPKI DER in hex: the box's PLACEMENT_PUBLIC_KEY. */
export const PLACEMENT_PUBLIC_KEY = '302a300506032b65700321004afd39342aac6a4de6066cb72e9df54cbd3d4eb522e5e6e175a17954ab98f25e';
const PIN = 'test/pins/catalogue.json';
const FETCH_MS = 20_000;
/** The format's 7 × 7 (shard-format `GRID_RADIUS`, SA29), as the MMO's `placeCell` bounds a spot. */
const GRID_RADIUS = 3;

/** One placed cell: the placement file's row and a grid catalogue's cell. */
export interface Cell { readonly instance: string; readonly slug: string; readonly cell: readonly [number, number] }
interface Catalogue {
  readonly grid: { readonly cells: readonly Cell[] };
  readonly shards: readonly { readonly slug: string }[];
  readonly missing: readonly string[];
}
/** What asking staging gave: its placed cells (a verified file), none placed (404), or down (anything else). */
export type StagingAnswer = { readonly placed: readonly Cell[]; readonly serial: number } | { readonly none: string } | { readonly down: string };
/** The live preview's catalogue, or why it couldn't be read. */
export type LastAnswer = { readonly catalogue: unknown } | { readonly down: string };
export interface Borrowed {
  /** The pinned catalogue with staging's placed cells after its own. */
  readonly document: Catalogue;
  readonly cells: readonly Cell[];
  /** `staging` read and believed; `kept` the live preview's cells; `pinned` neither. */
  readonly source: 'staging' | 'kept' | 'pinned';
  readonly lines: readonly string[];
  /** Set when the run kept an older grid or fell back to the pin: the workflow's warning. */
  readonly warning?: string;
}

const bare = (slug: string): string => slug.replace(/^_/u, '');
const at = (cell: Cell): string => `(${String(cell.cell[0])},${String(cell.cell[1])})`;
const named = (cells: readonly Cell[]): string => cells.map(cell => `${cell.instance} (${cell.slug}) at ${at(cell)}`).join(', ');

/** A catalogue's cells the pin's grid doesn't hold: the cells a page borrowed. */
export function borrowedCells(pin: Catalogue, catalogue: unknown): readonly Cell[] {
  const cells = (catalogue as { grid?: { cells?: unknown } } | null)?.grid?.cells;
  if (!Array.isArray(cells)) throw new Error('a catalogue with no grid cells');
  const pinned = new Set(pin.grid.cells.map(cell => cell.instance));
  return (cells as Cell[]).filter(cell => !pinned.has(cell.instance)).map(({ instance, slug, cell }) => ({ instance, slug, cell: [cell[0], cell[1]] }));
}

/**
 * The grid preview builds: the pin's cells, then the borrowed ones. A cell is refused, as the staging MMO's `placeCell` refuses it, when its
 * spot is off the 7 × 7 or taken, its slug already has a cell, or its instance is taken; a cell the pin already places the same way is kept once.
 */
export function borrowGrid(pin: Catalogue, staging: StagingAnswer, last: LastAnswer): Borrowed {
  const lines: string[] = [];
  let source: Borrowed['source'], wanted: readonly Cell[], warning: string | undefined;
  if ('placed' in staging) {
    source = 'staging'; wanted = staging.placed;
    lines.push(`staging's placement file, serial ${String(staging.serial)}, signature good: ${String(wanted.length)} placed cell(s)`);
  } else {
    let kept: readonly Cell[] | undefined, why = '';
    if ('catalogue' in last) try { kept = borrowedCells(pin, last.catalogue); } catch (error) { why = error instanceof Error ? error.message : String(error); }
    else why = last.down;
    if ('none' in staging && (kept === undefined || kept.length === 0)) {
      source = 'staging'; wanted = [];
      lines.push(`staging has placed no cell (${staging.none}): the pinned grid`);
    } else {
      // The API rewrites its file and never deletes it, so a missing file after a placement is a fault, like an unreadable one.
      const fault = 'none' in staging ? `${staging.none}, though the live preview borrowed cells` : 'down' in staging ? staging.down : '';
      if (kept === undefined) {
        source = 'pinned'; wanted = [];
        warning = `staging's grid unreadable (${fault}), and so is the live preview's (${why}): this preview has the pinned grid only`;
      } else {
        source = 'kept'; wanted = kept;
        warning = `staging's grid unreadable (${fault}): kept the live preview's grid, ${String(kept.length)} borrowed cell(s)`;
      }
      lines.push(warning);
    }
  }
  const cells: Cell[] = [], left: string[] = [], spots = new Map<string, string>(), slugs = new Map<string, string>(), instances = new Map<string, string>();
  for (const cell of pin.grid.cells) { spots.set(cell.cell.join(','), cell.instance); slugs.set(bare(cell.slug), cell.instance); instances.set(cell.instance, cell.slug); }
  for (const cell of wanted) {
    const [x, z] = cell.cell, spot = `${String(x)},${String(z)}`;
    if (instances.get(cell.instance) === cell.slug && spots.get(spot) === cell.instance) continue;
    const refused = !Number.isInteger(x) || !Number.isInteger(z) || Math.abs(x) > GRID_RADIUS || Math.abs(z) > GRID_RADIUS ? 'off the 7 × 7'
      : spots.has(spot) ? `on ${spots.get(spot) ?? ''}'s spot`
      : slugs.has(bare(cell.slug)) || instances.has(cell.slug) ? `${cell.slug} already has a cell (${slugs.get(bare(cell.slug)) ?? cell.slug})`
      : instances.has(cell.instance) || slugs.has(bare(cell.instance)) ? `${cell.instance} is taken` : '';
    if (refused !== '') { left.push(`left out ${cell.instance} (${cell.slug}) at ${at(cell)}: ${refused}`); continue; }
    spots.set(spot, cell.instance); slugs.set(bare(cell.slug), cell.instance); instances.set(cell.instance, cell.slug);
    cells.push({ instance: cell.instance, slug: cell.slug, cell: [x, z] });
  }
  // A cell staging's MMO may play but preview can't place breaks "the same cell": warn, as for a fault.
  lines.push(...left);
  if (left.length > 0) warning = [warning, `${String(left.length)} staging cell(s) left out of preview's grid: ${left.join('; ')}`].filter(line => line !== undefined).join('; ');
  // A borrowed slug this build has no head for is "placed, with no head at this stage" (shard-format's `missing`).
  const heads = new Set(pin.shards.map(head => bare(head.slug))), missing = [...pin.missing];
  for (const cell of cells) if (!heads.has(bare(cell.slug)) && !missing.includes(cell.slug)) missing.push(cell.slug);
  lines.push(cells.length === 0 ? `preview's grid: the pinned ${String(pin.grid.cells.length)} cells, none borrowed`
    : `preview's grid: the pinned ${String(pin.grid.cells.length)} cells and ${String(cells.length)} from staging: ${named(cells)}`);
  return { document: { ...pin, grid: { ...pin.grid, cells: [...pin.grid.cells, ...cells] }, missing }, cells, source, lines, ...(warning === undefined ? {} : { warning }) };
}

/** Whether two borrowed sets place the same cells. */
export function sameCells(a: readonly Cell[], b: readonly Cell[]): boolean {
  const key = (cells: readonly Cell[]): string => cells.map(cell => `${cell.instance}=${cell.slug}@${cell.cell.join(',')}`).sort().join(' ');
  return key(a) === key(b);
}

/** A signed file's body under `key`, Node built-ins only (the `--news` pass, before install). Engine's `readSigned` is the write's check. */
function signedBody(text: string, key: string): unknown {
  const signed = JSON.parse(text) as { body?: unknown; signature?: unknown };
  if (typeof signed.body !== 'string' || typeof signed.signature !== 'string') throw new Error('not a signed file');
  if (!verify(null, Buffer.from(signed.body), createPublicKey({ key: Buffer.from(key, 'hex'), format: 'der', type: 'spki' }), Buffer.from(signed.signature, 'hex'))) throw new Error('a bad signature');
  // The shape engine's PlacementSchema checks, roughly: a body the write's reader refuses must not make news every hour.
  const body = JSON.parse(signed.body) as { kind?: unknown; serial?: unknown; cells?: unknown };
  const id = (value: unknown): boolean => typeof value === 'string' && /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) && value.length <= 64;
  if (body.kind !== 'placement' || !Number.isInteger(body.serial) || !Array.isArray(body.cells) || body.cells.length > 49
    || !body.cells.every((row: { instance?: unknown; slug?: unknown; cell?: unknown }) => id(row.instance) && id(row.slug) && Array.isArray(row.cell) && row.cell.length === 2 && row.cell.every(Number.isInteger))) throw new Error('not a placement file');
  return body;
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  if (url.startsWith('file:')) {
    try { return { status: 200, text: readFileSync(new URL(url), 'utf8') }; }
    catch (error) { if ((error as { code?: string }).code === 'ENOENT') return { status: 404, text: '' }; throw error; }
  }
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${String(Date.now())}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(FETCH_MS) });
  return { status: response.status, text: await response.text() };
}
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Ask staging: its placement file, read by `read` (engine's reader for the write, `signedBody` for news). */
export async function askStaging(url: string, read: (text: string) => Promise<{ readonly channel: string; readonly serial: number; readonly cells: readonly Cell[] }>): Promise<StagingAnswer> {
  try {
    const { status, text } = await fetchText(url);
    if (status === 404) return { none: `no placement file at ${url}` };
    if (status !== 200) return { down: `${url} answered ${String(status)}` };
    const file = await read(text);
    if (file.channel !== 'staging') return { down: `${url} is a ${file.channel} placement file` };
    return { placed: file.cells, serial: file.serial };
  } catch (error) { return { down: `${url}: ${message(error)}` }; }
}
export async function askLast(url: string): Promise<LastAnswer> {
  try {
    const { status, text } = await fetchText(url);
    return status === 200 ? { catalogue: JSON.parse(text) as unknown } : { down: `${url} answered ${String(status)}` };
  } catch (error) { return { down: `${url}: ${message(error)}` }; }
}

async function main(argv: readonly string[]): Promise<void> {
  const flag = (name: string): string | undefined => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const placements = flag('placements') ?? STAGING_PLACEMENTS, lastUrl = flag('last') ?? LIVE_PREVIEW_CATALOGUE, key = flag('key') ?? PLACEMENT_PUBLIC_KEY;
  const pin = JSON.parse(readFileSync(PIN, 'utf8')) as Catalogue, out = argv.find(arg => !arg.startsWith('--'));
  const github = (file: string | undefined, text: string): void => { if (file !== undefined && file !== '') appendFileSync(file, text); };
  const news = argv.includes('--news'), { GITHUB_OUTPUT, GITHUB_ACTIONS, GITHUB_STEP_SUMMARY } = process.env;
  if (!news && out === undefined) throw new Error('usage: preview-grid.ts <out.json> | --news [--placements=<url>] [--last=<url>] [--key=<hex>]');
  // The write believes only engine's own reader (`readPlacementFile`, the staging MMO's check); `--news` runs before install.
  const read = news ? (text: string): Promise<{ channel: string; serial: number; cells: Cell[] }> => Promise.resolve(signedBody(text, key) as { channel: string; serial: number; cells: Cell[] })
    : async (text: string): Promise<{ readonly channel: string; readonly serial: number; readonly cells: readonly Cell[] }> => {
      const { readPlacementFile } = await import('../src/server/host/dedicated/placementFile.ts');
      return readPlacementFile(text, key);
    };
  const [staging, last] = await Promise.all([askStaging(placements, read), askLast(lastUrl)]);
  const borrowed = borrowGrid(pin, staging, last);
  for (const line of borrowed.lines) console.log(`preview grid: ${line}`);
  if (news) {
    // A deploy is news when staging's cells differ from what the live preview shows; a kept grid is the live one, so no news.
    let shown: readonly Cell[] | undefined;
    try { if ('catalogue' in last) shown = borrowedCells(pin, last.catalogue); } catch { shown = undefined; }
    // An unreadable live catalogue is news only when staging has a cell to show.
    const fresh = borrowed.source === 'staging' && (shown === undefined ? borrowed.cells.length > 0 : !sameCells(shown, borrowed.cells));
    console.log(fresh ? 'preview grid: staging\'s grid differs from the live preview\'s: deploy' : 'preview grid: the live preview already shows staging\'s grid');
    github(GITHUB_OUTPUT, `news=${String(fresh)}\n`);
    return;
  }
  const file = resolve(out ?? '');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(borrowed.document)}\n`);
  console.log(`preview grid: wrote ${file}`);
  // A workflow command ends at a newline, and fetched error text can hold one: GitHub's own escapes.
  const escaped = (text: string): string => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  if (borrowed.warning !== undefined && GITHUB_ACTIONS === 'true') console.log(`::warning title=preview grid::${escaped(borrowed.warning)}`);
  github(GITHUB_STEP_SUMMARY, `### Preview grid (SA35)\n\n${borrowed.lines.map(line => `- ${line}`).join('\n')}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(`preview grid: ${message(error)}`); process.exitCode = 1; }
}
