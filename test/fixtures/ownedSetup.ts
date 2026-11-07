/** A timed-out hook still owns its pending resource until teardown retires it.
 * Construction starts only at open(); close() never starts or replaces it. */
export function ownedSetup<T>(prepare: () => Promise<T>, dispose: (resource: T) => Promise<void>): {
  open: () => Promise<T>; close: () => Promise<void>;
} {
  let pending: Promise<{ok: true; resource: T} | {ok: false; error: unknown}> | undefined;
  let closing: Promise<void> | undefined;
  return {
    open: async () => {
      if (pending !== undefined || closing !== undefined) throw new Error('Setup already opened or closed');
      pending = (async () => {
        try { return {ok: true as const, resource: await prepare()}; }
        catch (error) { return {ok: false as const, error}; }
      })();
      const result = await pending;
      if (!result.ok) throw result.error;
      return result.resource;
    },
    close: () => closing ??= (async () => {
      const result = await pending;
      // Preparation owns its failure cleanup; open() retains that exact error.
      if (result?.ok === true) await dispose(result.resource);
    })(),
  };
}
