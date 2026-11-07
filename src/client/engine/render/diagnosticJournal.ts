import { isDev, onDev } from '../core/devMode';
import { installAllocationJournal } from './allocationJournal';

const developerMode = { read: isDev, subscribe: onDev };

/** Public play leaves native GL functions untouched. Enabling Developer starts a new diagnostic interval;
 * it does not pretend to reconstruct allocations made before instrumentation began. Census harnesses install
 * their marker before renderer creation and keep the journal for the renderer's complete lifetime. */
export function installDiagnosticJournal(
  context: Parameters<typeof installAllocationJournal>[0],
  mode: { read: () => boolean; subscribe: (read: (on: boolean) => void) => () => void } = developerMode,
  install: typeof installAllocationJournal = installAllocationJournal,
): () => void {
  const census = typeof window !== 'undefined' && typeof Reflect.get(window, '__sc_label_gl') === 'function';
  let stop: (() => void) | undefined;
  const refresh = (developer: boolean): void => {
    if (developer || census) stop ??= install(context);
    else { stop?.(); stop = undefined; }
  };
  refresh(mode.read());
  const unsubscribe = mode.subscribe(refresh);
  return () => { unsubscribe(); stop?.(); stop = undefined; };
}
