// oxlint-disable-next-line import/no-unassigned-import -- Portable Math precedes simulation modules.
import '../../src/shared/engine/core/portableMathFirst';
import { createNativeProofWorker as createWorker } from '../../src/test/game/headlessWorker';
import type { Shardfile } from '../../src/shared/host/shardfile';

export type NativeProofKind = 'driftwood' | 'driftwood-trade' | 'sky-verbs' | 'pine' | 'pine-verbs' | 'nine' | 'nine-flat' | 'nalati' | 'nalati-companions' | 'nalati-weapons' | 'nalati-predators' | 'nalati-world' | 'nalati-stealth' | 'nalati-verbs' | 'nalati-kokpar' | 'nalati-chapter' | 'nalati-king' | 'nalati-qara' | 'nalati-titan' | 'nalati-practice' | 'trusted' | 'deferred';

const modules: Readonly<Record<NativeProofKind, string>> = {"driftwood": "../proof/driftwood-isle/worker", "driftwood-trade": "./driftwood-trade-native", "sky-verbs": "./sky-verbs", "pine": "./headless/folderPlan", "pine-verbs": "./pine-verbs", "nine": "./nine-headless", "nine-flat": "./headless/nineFlat", "nalati": "./headless/folderPlan", "nalati-companions": "./nalati-companions-native", "nalati-weapons": "./nalati-weapons-native", "nalati-predators": "./nalati-predators-native", "nalati-stealth": "./nalati-stealth-native", "nalati-kokpar": "./nalati-kokpar-native", "nalati-chapter": "./nalati-chapter-native", "nalati-king": "./nalati-king-native", "nalati-qara": "./nalati-qara-native", "nalati-titan": "./nalati-titan-native", "nalati-practice": "./nalati-practice-native", "nalati-world": "./nalati-world-verbs", "nalati-verbs": "./nalati-verbs", "trusted": "./headless/nativeRuntime", "deferred": "./headless/deferredRuntime"};

/** Legacy engine fixtures choose their local composition; the published worker owns no shard catalogue. */
export function createNativeProofWorker(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, kind: NativeProofKind,
  snapshot?: string | PromiseLike<string>, sections?: ReadonlyMap<string, unknown>, directory = `out/${shard.identity.slug}`): ReturnType<typeof createWorker> {
  return createWorker(shard, assets, new URL(`${modules[kind]}.ts`, import.meta.url), {
    ...(snapshot === undefined ? {} : {snapshot}), ...(sections === undefined ? {} : {sections}),
    ...(kind === 'trusted' || kind === 'deferred' ? {} : {directory}),
  });
}
