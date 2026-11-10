import type { Scope } from '@wildshard/engine/app/scope';

/** Start code reads together, but report failures only at the original boot
 * barrier. A preceding import failure wins over a later admission refusal. */
export function prepareBootImports<T>(pending: Promise<T>): {
  readonly ready: () => Promise<T>; readonly check: () => void; readonly refuse: (error: unknown) => Promise<never>;
} {
  let failed: { readonly error: unknown } | undefined;
  const settled = (async () => {
    try { return { ok: true as const, value: await pending }; }
    catch (error) { failed = { error }; return { ok: false as const, error }; }
  })();
  const ready = async (): Promise<T> => {
    const result = await settled;
    if (!result.ok) throw result.error;
    return result.value;
  };
  return { ready, check: () => { if (failed !== undefined) throw failed.error; },
    refuse: async error => { await ready(); throw error; } };
}

interface TitleWarmup { readonly warmShaderCompiler: (scope: Scope) => void }
interface TitleWarmupPage extends EventTarget { reportError: (error: unknown) => void }

/** The shader warm-up is optional. A departing WebKit document can cancel its
 * native module read before the new page starts. Live failures still report. */
export async function startTitleWarmup(pending: Promise<TitleWarmup>, owner: Scope, page: TitleWarmupPage): Promise<void> {
  const lifetime = owner.child('title.shader-warmup');
  let leaving = false;
  lifetime.listen(page, 'beforeunload', () => { leaving = true; });
  lifetime.listen(page, 'pagehide', () => { leaving = true; });
  lifetime.listen(page, 'pageshow', () => { leaving = false; });
  try {
    const { warmShaderCompiler } = await pending;
    if (!leaving && !lifetime.disposed) warmShaderCompiler(owner);
  } catch (error) {
    const cancelled = (error instanceof DOMException && error.name === 'AbortError')
      || (error instanceof TypeError && error.message === 'Importing a module script failed.');
    if (!leaving || !cancelled) page.reportError(error);
  } finally {
    lifetime.dispose();
  }
}
