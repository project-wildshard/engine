/** The two existing title warm-up owners, observed without changing their scheduling. */
export interface TitlePreparationState { readonly pending: readonly string[]; readonly issue: string | null }

/** Borrow already-started work; a visible title is not proof that these owners have finished. */
export function observeTitlePreparation(shaders: Promise<void>, firstFrame: Promise<void>): { state: () => TitlePreparationState } {
  const pending = new Set(['shaders', 'first-world-frame']);
  let issue: string | null = null;
  const observe = async (name: string, work: Promise<void>): Promise<void> => {
    try { await work; }
    catch (error: unknown) { issue ??= error instanceof Error ? error.message : String(error); }
    finally { pending.delete(name); }
  };
  for (const [name, work] of [['shaders', shaders], ['first-world-frame', firstFrame]] as const) {
    void observe(name, work);
  }
  return { state: () => ({ pending: [...pending], issue }) };
}

/** Reserve the existing delayed title draw until it actually completes or its owner leaves.
 * The caller supplies the page's existing scope and draw counter; no game frame is synthesized. */
export function prepareTitleFrame(owner: {
  readonly later: (ms: number, run: () => void) => void;
  readonly next: (run: () => void) => void;
  readonly onDispose: (run: () => void) => void;
  readonly disposed: () => boolean;
  readonly skip: () => boolean;
  readonly frame: () => number;
  readonly prime: () => void;
}): Promise<void> {
  return new Promise(resolve => {
    owner.onDispose(resolve);
    owner.later(1200, () => {
      if (owner.disposed() || owner.skip()) { resolve(); return; }
      const before = owner.frame();
      owner.prime();
      const drawn = (): void => {
        if (owner.disposed() || owner.frame() > before) resolve();
        else owner.next(drawn);
      };
      owner.next(drawn);
    });
  });
}
