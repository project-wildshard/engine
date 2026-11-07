import { selectTier, parseTierPick, type TierChoice } from './tierSelect';
import { mobileDevice } from '../boot/titleArrival';
import { benchmarkTierGpu, gpuRenderer } from './tierBenchmark';
import { desktopFloor, DESKTOP_REFERENCE } from './desktopReference';
import { saveStorage, jsonSlot } from '../saves/slots';
import { setting, settingFromUrl } from '../ui/Settings';

const key = 'render.tierPick';
jsonSlot(key, 'device');
const storage = saveStorage('device');
const calibrationFiles = typeof import.meta.glob === 'function' ? import.meta.glob<string>('../../../../budgets/calibration.json', { eager: true, query: '?raw', import: 'default' }) : {};
function selectionFloor(): number {
  const raw = Object.values(calibrationFiles)[0];
  if (raw === undefined) return desktopFloor();
  const doc: unknown = JSON.parse(raw);
  if (typeof doc !== 'object' || doc === null || Reflect.get(doc, 'stable') !== true) return desktopFloor();
  const selection: unknown = Reflect.get(doc, 'tierSelection'), desktop: unknown = Reflect.get(doc, 'desktop');
  const score: unknown = typeof selection === 'object' && selection !== null ? Reflect.get(selection, 'm5Score') : undefined;
  const ratio: unknown = typeof desktop === 'object' && desktop !== null ? Reflect.get(desktop, 'k3060') : undefined;
  return (typeof score === 'number' && Number.isFinite(score) && score > 0 ? score : DESKTOP_REFERENCE.m5Score) * (typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : DESKTOP_REFERENCE.k3060);
}
let choice: TierChoice | null = null;
let pending: Promise<TierChoice> | null = null;
export function tierPickInfo(): TierChoice | null { return choice; }
export function tierPickLine(): string { return choice ? `${choice.tier} · ${choice.via} · ${choice.detail}` : 'Auto tier will be picked when a world loads'; }
export function forgetTierPick(): void { storage.removeItem(key); }
export function bootTier(): Promise<TierChoice> {
  pending ??= pick(); return pending;
}
async function pick(): Promise<TierChoice> {
  const forced = setting('tier');
  const gpu: { canvas: HTMLCanvasElement | null; gl: WebGL2RenderingContext | null } = { canvas: null, gl: null };
  const context = (): WebGL2RenderingContext => { gpu.canvas ??= document.createElement('canvas'); gpu.gl ??= gpu.canvas.getContext('webgl2', { powerPreference: 'high-performance' }); if (!gpu.gl) throw new Error('GPU tier probe unavailable'); return gpu.gl; };
  let cached = null;
  try { cached = parseTierPick(JSON.parse(storage.getItem(key) ?? 'null') as unknown); } catch { /* storage unavailable: classify this load */ }
  try {
    choice = await selectTier({
      ...(forced !== 'auto' ? settingFromUrl('tier') ? { harness: forced } : { preference: forced } : {}),
      mobile: mobileDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
      renderer: () => gpuRenderer(context()), cached, desktopFloor: selectionFloor(), now: () => Date.now(),
      benchmark: async () => (await benchmarkTierGpu(context())).score,
    });
    if (choice.pick) try { storage.setItem(key, JSON.stringify(choice.pick)); } catch { /* current pick still applies without storage */ }
    return choice;
  } catch (error) {
    // Let the renderer's existing recovery path handle an unavailable context; do not retain a failed pick.
    choice = { tier: 'phone', via: 'unavailable', detail: error instanceof Error ? error.message : 'GPU probe unavailable' };
    return choice;
  } finally { gpu.gl?.getExtension('WEBGL_lose_context')?.loseContext(); gpu.canvas?.remove(); }
}
