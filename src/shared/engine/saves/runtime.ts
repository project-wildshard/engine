import { SaveStore, type SchemaFailure } from './store';
import { saveEnvironment } from './environment';

declare const __BUILD_ID__: string;
let report: ((failure: SchemaFailure) => void) | null = null;
const pending: SchemaFailure[] = [];
/** The same service exposed as app.saves, available before the app/renderer graph evaluates. */
export const saves: SaveStore = new SaveStore({
  build: (() => { try { return __BUILD_ID__; } catch { return ''; } })(),
  report: (failure) => { if (report) report(failure); else { pending.push(failure); if (pending.length > 32) pending.shift(); } },
});
export function installSaveReporter(fn: (failure: SchemaFailure) => void): void { report = fn; for (const failure of pending.splice(0)) fn(failure); }
/** a home-screen app (standalone display): the PWA whose storage the browser may keep */
export function standaloneDisplay(): boolean {
  return saveEnvironment().standalone?.() ?? false;
}
/** asks for persistent storage once, on a home-screen page; each call to this factory has its own "once" (E422) */
export function homeScreenPersistence(standalone: () => boolean = standaloneDisplay): (store?: Pick<SaveStore, 'persist'>) => void {
  let requested = false;
  return (store = saves) => {
    if (requested || !standalone()) return;
    requested = true; void store.persist();
  };
}
/** The entry calls this before either the title or a direct chunk boot. Ask in
 * tabs as well as installed apps; the save store owns the one native request
 * and records its actual grant/denial for storage diagnostics. */
export const persistHomeScreen: (store?: Pick<SaveStore, "persist">) => void = homeScreenPersistence(() => true);
