// REMOTE-PLAYERS: the room each `remote-*-proof.mjs` proves its row in, on the rig of `online-rig.mjs`. Every row's check is an
// exported `prove…(room)` that takes the pages already in the world; run on its own, `runAlone` opens a room for it (Jake, then
// Jimmy) and keeps its captures, and `remote-players-proof.mjs` (RP13) runs every row's check in one room.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';

/** @typedef {{ page: import('playwright').Page, context: import('playwright').BrowserContext, errors: string[] }} Entered */
/** @typedef {(step: string, ok: boolean, detail?: unknown) => void} Note */
/** A row's check: Jake's and Jimmy's pages in the world (Jimmy null when the check brings him in itself), where to shoot, and a
 *  way to bring in another page. It returns the captures it took, as file names in `shots`.
 *  @typedef {{ jake: Entered, jimmy: Entered | null, note: Note, shots: string, enter: (name: string) => Promise<Entered> }} Room */

/** Whether this module is the script node was asked to run. @param {string} url */
export const isMain = url => process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(url);

/** The steps a proof checked, and how it notes one. */
export function recorder() {
  const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
  /** @type {Note} */
  const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 500)}`}`); };
  return { steps, note };
}

/** One room on a shard (Driftwood unless named), headless Chromium at 402×874 on the GPU, and a way to bring a page into it.
 *  @param {{ dist: string, work: string, keyFile: string, shard?: string }} options */
export async function openRoom({ dist, work, keyFile, shard = 'driftwood-isle' }) {
  const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard }), url = `${rig.base}/?chunk=${shard}&mute=1&nolock=1&skipintro=1`;
  const launched = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] }).catch(async (/** @type {unknown} */ error) => { await rig.close(); throw error; });
  const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro']; // 402×874
  const pages = /** @type {Entered[]} */ ([]);
  /** @param {string} name */
  const enter = async name => { const entered = await enterPage(launched, phone, url, name); pages.push(entered); await intoWorld(entered.page); return entered; };
  /** Every page's errors, past the link's own noise. */
  const faults = () => pages.flatMap(entered => entered.errors).filter(line => !/WebSocket connection|ERR_CONNECTION|Failed to load resource/u.test(line));
  return { rig, enter, faults, close: async () => { await launched.close(); await rig.close(); } };
}

/** Copy a check's captures to `keep`, each named `<prefix>-<file>` (or as it is, for no prefix).
 *  @param {string} shots @param {string[]} taken @param {string} keep @param {string} prefix @param {Note} note */
export function keepShots(shots, taken, keep, prefix, note) {
  mkdirSync(keep, { recursive: true });
  for (const shot of taken) { try { copyFileSync(join(shots, shot), join(keep, prefix === '' ? shot : `${prefix}-${shot}`)); } catch { note(`capture ${shot} kept`, false); } }
}

/**
 * A row's check run on its own: `<app dist> <work dir> <key.json> [--shots=<dir>]`, one Driftwood room, Jake then Jimmy (only
 * Jake when `alone`), the check, its captures kept under `prefix`, no page error, and PASS or FAIL as the exit code.
 * @param {string} name @param {string} prefix @param {(room: Room) => Promise<string[]>} prove @param {{ alone?: boolean }} [options]
 */
export async function runAlone(name, prefix, prove, { alone = false } = {}) {
  const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
  if (dist === '' || work === '' || keyFile === '') throw new Error(`usage: ${name}-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>]`);
  const keep = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? '', shots = join(work, `shots-${name}`);
  mkdirSync(shots, { recursive: true });
  const { steps, note } = recorder(), room = await openRoom({ dist, work, keyFile });
  let code = 1;
  try {
    const jake = await room.enter('Jake'), jimmy = alone ? null : await room.enter('Jimmy');
    const taken = await prove({ jake, jimmy, note, shots, enter: room.enter });
    if (keep !== '') keepShots(shots, taken, keep, prefix, note);
    const faults = room.faults();
    note('no page error', faults.length === 0, faults.slice(0, 6));
    code = steps.every(row => row.ok) ? 0 : 1;
  } catch (error) {
    note('the proof stopped', false, String(error).slice(0, 400));
  } finally {
    await room.close();
  }
  console.log(code === 0 ? 'PASS' : 'FAIL');
  process.exitCode = code;
}
