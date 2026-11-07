import { appIdentity } from '../app/identity';
import type { SaveStorage } from './store';

export const LEGACY_GAME_KEYS = ['ws.settings.v1', 'ws.gfx.v1', 'ws.hints.v1', 'ws.review.v1', 'ws.review.queue.v1', 'ws.progress.v1', 'ws.inventory.v1', 'ws.flags.v1', 'ws.boss.v1', 'ws.elites.v1', 'ws.purse.v1', 'ws.owned.v1', 'ws.bounty.v1', 'ws.compendium.v1', 'ws.skins.v1', 'ws.nalati.skins.v1', 'ws.nalati.tulpar', 'ws.nalati.horseNames', 'ws.ph.loadout.v1', 'ws.lodge.v1', 'ws.debug'] as const;
export const LEGACY_DEVICE: Readonly<Record<string, string>> = {
  'ws.dev': 'devMode', 'ws.debug.open': 'debug.open', 'ws.perf.probe': 'perf.probe', 'ws.perf.rec.v1': 'perf.rec', 'ws.perf.lap.v1': 'perf.lap',
  'ws.lastUnload': 'life.lastUnload', 'ws.lastEnd': 'life.lastEnd',
  'ws.nineBoot': 'boot.trace', wsNineReports: 'boot.reports', wsErrQueue: 'err.queue', 'ws.titleArrival.once': 'titleArrival.once',
};
export const LEGACY_SESSION: Readonly<Record<string, string>> = {
  'ws.alive': 'life.alive', wsErrSession: 'err.session', wsErrReloads: 'err.reloads', wsGpuReloads: 'gpu.reloads',
  wsResumeShot: 'resume.shot', wsResumeBrand: 'resume.brand', wsClearDownloads: 'clearDownloads.report',
  'ws.titleArrival': 'titleArrival', 'ws.loadAttempt': 'loadAttempt',
};
const TEXT = new Set(['perf.probe', 'perf.rec', 'perf.lap', 'resume.shot']);
export function decodeLegacy(key: string, raw: string): unknown {
  if (key === 'devMode') return raw === '1';
  if (TEXT.has(key)) return raw;
  try { return JSON.parse(raw) as unknown; } catch { return raw; }
}
function carry(storage: SaveStorage | null, scope: 'device' | 'session', mapping: Readonly<Record<string, string>>): void {
  if (!storage) return;
  const name = `${appIdentity().savePrefix}${scope}`;
  let savedDoc: { keys: Record<string, unknown> } = { keys: {} };
  try { const raw: unknown = JSON.parse(storage.getItem(name) ?? '{"keys":{}}'); if (typeof raw === 'object' && raw !== null && 'keys' in raw && typeof raw.keys === 'object' && raw.keys !== null) savedDoc = { keys: { ...raw.keys } }; } catch { return; }
  for (const [old, key] of Object.entries(mapping)) {
    const raw = storage.getItem(old);
    if (raw !== null && savedDoc.keys[key] === undefined) savedDoc.keys[key] = { v: 1, data: decodeLegacy(key, raw) };
  }
  const records: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < storage.length; i++) {
    const old = storage.key(i); if (!old) continue;
    const family = old.startsWith('ws.fold.') ? ['ui.fold', old.slice(8)] : old.startsWith('ws.ktx2set.') ? ['ktx2set', old.slice(11)] : old.startsWith('ws-load-times:v1:') ? ['boot.times', old.slice(17)] : null;
    const [key, suffix] = family ?? []; if (!key || !suffix) continue;
    const raw = storage.getItem(old); if (raw !== null) (records[key] ??= {})[suffix] = decodeLegacy(key, raw);
  }
  for (const [key, data] of Object.entries(records)) if (savedDoc.keys[key] === undefined) savedDoc.keys[key] = { v: 1, data };
  storage.setItem(name, JSON.stringify(savedDoc));
}
/** Only named gameplay keys reset; pre-boot, diagnostic, per-tab and OTA keys survive. */
export function resetLegacy(local: SaveStorage | null, session: SaveStorage | null): void {
  if (local?.getItem(`${appIdentity().savePrefix}global`) !== null) return;
  carry(local, 'device', LEGACY_DEVICE); carry(session, 'session', LEGACY_SESSION);
  const deleted: string[] = [];
  for (let i = 0; i < local.length; i++) { const key = local.key(i); if (key && LEGACY_GAME_KEYS.some((old) => key === old || key.startsWith(`${old}:`))) deleted.push(key); }
  for (const key of deleted) local.removeItem(key);
  local.setItem(`${appIdentity().savePrefix}global`, '{"keys":{}}');
}
