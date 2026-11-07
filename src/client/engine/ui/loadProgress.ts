import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';
import { app } from '../app/runtime';
import { mountUi, uiScope } from './ownership';

interface Attempt { readonly total: number; done: number; failed: boolean }

/** Progress counts completed preparations, never elapsed time or estimated bytes.
 * A replacement or closed view cannot be painted by an older pending decoder. */
export class LoadProgress {
  readonly element: HTMLDivElement = document.createElement('div');
  private readonly label = document.createElement('span');
  private readonly bar = document.createElement('progress');
  private active: Attempt | undefined;

  constructor(host: HTMLElement) {
    this.element.className = 'ws-progress'; this.element.hidden = true;
    this.label.className = 'ws-mono';
    this.element.setAttribute('role', 'status'); this.element.setAttribute('aria-live', 'polite');
    const spinner = document.createElement('i'); spinner.setAttribute('aria-hidden', 'true');
    this.element.append(spinner, this.label, this.bar); host.append(this.element);
  }

  async watch(label: string, tasks: readonly Promise<unknown>[]): Promise<void> {
    this.clear();
    if (tasks.length === 0) return;
    const attempt: Attempt = { total: tasks.length, done: 0, failed: false };
    this.active = attempt; this.element.hidden = false;
    this.element.classList.remove('failed'); this.element.setAttribute('aria-busy', 'true');
    this.bar.max = attempt.total; this.bar.value = 0;
    const text = (): string => engineString('s_explore_load_count', [label, attempt.done, attempt.total]);
    const paint = (): void => { this.label.textContent = text(); this.bar.value = attempt.done; };
    paint();
    try {
      await Promise.all(tasks.map(async task => {
        await task;
        if (this.active !== attempt || attempt.failed) return;
        attempt.done++; paint();
      }));
      if (this.active === attempt) this.clear();
    } catch (error) {
      if (this.active === attempt) {
        attempt.failed = true; this.element.classList.add('failed');
        this.element.setAttribute('aria-busy', 'false');
        this.label.textContent = engineString('s_explore_load_failed', [text()]);
      }
      throw error;
    }
  }

  clear(): void { this.active = undefined; this.element.hidden = true; this.element.setAttribute('aria-busy', 'false'); }
  dispose(): void { this.clear(); this.element.remove(); }
}

/** A user-requested code feature owns visible preparation progress. Completion
 * counts the import, not guessed network bytes. Retirement always removes UI. */
export async function loadModuleWithProgress<T>(label: string, load: () => Promise<T>, parent?: Scope): Promise<T> {
  const owner = uiScope('module-load', parent), host = document.createElement('div'), progress = new LoadProgress(host);
  mountUi(host, owner, document.body);
  app.ui.push('modal', { root: progress.element, embedded: true, back: () => undefined }, owner);
  owner.onDispose(() => { progress.dispose(); });
  try {
    const reading = load();
    await progress.watch(label, [reading]);
    return await reading;
  } finally { owner.dispose(); }
}
