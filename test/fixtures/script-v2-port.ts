import type { compileDualScriptV2 } from '../../src/sharddev/test/compileDualScriptV2';

/** Each port's shadow adapters exercise the admitted artifacts as well as
 * compile them. CI discovers fixtures without a manually maintained list. */
export interface DualPortFixture {
  readonly input: Parameters<typeof compileDualScriptV2>[0];
  /** Retained shipping v0 source, recompiled against its pinned artifact and
   * exercised as the execution oracle by this port's verify callback. */
  readonly retainedV0?: { readonly path: string; readonly source: string };
  readonly verify: (pair: Awaited<ReturnType<typeof compileDualScriptV2>>) => Promise<void>;
}
