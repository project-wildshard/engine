import type { Scope } from '@wildshard/engine/app/scope';
import { isDev, onDev } from '@wildshard/engine/core/devMode';
import { mountUi } from '@wildshard/engine/ui/ownership';
import type { MemoryAdmission, MemoryAdmissionWarning } from '@wildshard/format/memoryAdmission';
import './memoryWarning.css';

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(3)} MB`;
/** Name the shard report behind the maximum (G556: every report is one shard's own cost, never the page total). */
export function memoryWarningChip(reports: readonly MemoryAdmissionWarning[], entered?: string | null): string | null {
  let largest: MemoryAdmissionWarning | undefined;
  let over = -1;
  for (const report of reports) {
    if (entered !== undefined && report.stage !== 'resident' && report.owner !== entered) continue;
    const bytes = Math.max(report.playingOverBytes, report.loadingOverBytes);
    if (bytes > over) { largest = report; over = bytes; }
  }
  return largest === undefined ? null
    : `MEMORY LIMIT · ${largest.owner} ${largest.stage === 'resident' ? 'RESIDENT' : 'ESTIMATE'} · +${(over / 1_000_000).toFixed(1)} MB`;
}
/** G628 M4: the resident over-limit rows (a loaded shard's own cost over its limit) that a grid page's memory strip shows
 *  as lines; a cold estimate (a neighbour's worst spot if loaded alone) is never one. */
export function residentOverLimit(memory: Pick<MemoryAdmission, 'reports'>): readonly { readonly owner: string; readonly overBytes: number }[] {
  return memory.reports().filter(report => report.stage === 'resident')
    .map(report => ({ owner: report.owner, overBytes: Math.max(report.playingOverBytes, report.loadingOverBytes) })).filter(row => row.overBytes > 0);
}
/** G216: visible only for a Developer override, showing full claims and original caps rather than an altered allowance. */
export function memoryWarningLines(row: MemoryAdmissionWarning): readonly string[] {
  return [
    `${row.owner} · ${row.id}`,
    `PLAYING ${mb(row.playingBytes)} / ${mb(row.playingCap)} · OVER ${mb(row.playingOverBytes)}`,
    `LOADING ${mb(row.loadingBytes)} / ${mb(row.loadingCap)} · OVER ${mb(row.loadingOverBytes)}`,
    `CLAIM ${mb(row.claimedBytes)} · TOTAL ACCOUNTED ${mb(row.accountedBytes)}`,
    ...(row.categories === undefined ? [] : Object.entries(row.categories).map(([key, bytes]) => `${key.toUpperCase()} ${mb(bytes)}`)),
    ...(row.measured === undefined ? [] : [`MEASURED WEBCONTENT ${mb(row.measured.webContentBytes)} + GL ${mb(row.measured.glBytes)}`,
      `CALIBRATED BASE ${mb(row.measured.engineBaseBytes)} · ${row.measured.rev}`, `${row.measured.device} · ${row.measured.evidence}`]),
  ];
}
/**
 * G216 / E332: one scope-owned warning on an entered shard's HUD. The trusted policy also feeds G217's separate blocked
 * cell screen. The warning starts as a tappable chip; only its chip and expanded details receive pointers. Full numeric reports stay available.
 * Cold estimates show only for the entered shard; resident violations remain visible for every loaded shard.
 * The returned setter follows existing cell transitions; reports and admission policy stay unchanged.
 * No timer, control movement, authored HTML or additional admission runs; public pages create no panel.
 */
export function installMemoryWarning(memory: MemoryAdmission, scope: Scope, hudRoot: HTMLElement, initialOwner: string | null): (owner: string | null) => void {
  let entered = initialOwner;
  let surface: { root: HTMLElement; chip: HTMLButtonElement; details: HTMLElement } | undefined;
  const createSurface = (): { root: HTMLElement; chip: HTMLButtonElement; details: HTMLElement } => {
    const root = document.createElement('section'); root.className = 'ws-memory-warning'; root.setAttribute('role', 'status');
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'ws-memory-warning-chip';
    chip.setAttribute('aria-expanded', 'false');
    const details = document.createElement('div'); details.className = 'ws-memory-warning-details'; details.hidden = true;
    root.append(chip, details); mountUi(root, scope, hudRoot);
    scope.listen(root, 'pointerdown', (event: Event) => { event.stopPropagation(); });
    scope.listen(chip, 'click', (event: Event) => {
      event.stopPropagation(); const expanded = details.hidden !== false; details.hidden = !expanded; chip.setAttribute('aria-expanded', String(expanded));
    });
    scope.listen(details, 'click', (event: Event) => { event.stopPropagation(); });
    return { root, chip, details };
  };
  const refresh = (): void => {
    if (scope.disposed || scope.disposing) return;
    const reports = memory.reports().filter(report => report.stage === 'resident' || report.owner === entered);
    if (!isDev() || reports.length === 0) { if (surface !== undefined) surface.root.hidden = true; return; }
    surface ??= createSurface();
    surface.root.hidden = false;
    surface.chip.textContent = memoryWarningChip(reports);
    const title = document.createElement('b'); title.textContent = 'DEVELOPER · MEMORY LIMIT EXCEEDED';
    const rows = reports.map(report => {
      const section = document.createElement('div'); section.className = 'ws-memory-warning-report';
      section.dataset['owner'] = report.owner; section.dataset['claimedBytes'] = String(report.claimedBytes);
      section.dataset['playingBytes'] = String(report.playingBytes); section.dataset['loadingBytes'] = String(report.loadingBytes);
      section.dataset['playingCap'] = String(report.playingCap); section.dataset['loadingCap'] = String(report.loadingCap);
      section.textContent = memoryWarningLines(report).join('\n'); return section;
    });
    surface.details.replaceChildren(title, ...rows);
  };
  scope.onDispose(memory.subscribe(refresh)); scope.onDispose(onDev(refresh));
  return owner => { entered = owner; refresh(); };
}
