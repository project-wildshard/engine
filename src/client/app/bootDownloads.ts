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
