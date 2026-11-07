/// <reference types="vite/client" />
// oxlint-disable-next-line typescript/triple-slash-reference -- Ambient module scripts have no exports to import; scripts need their declarations.
/// <reference path="../../src/client/engine/types/n8ao.d.ts" />
// oxlint-disable-next-line typescript/triple-slash-reference -- Ambient module scripts have no exports to import; scripts need their declarations.
/// <reference path="../../src/client/engine/types/meshopt-simplifier.d.ts" />
// oxlint-disable-next-line typescript/triple-slash-reference -- Ambient module scripts have no exports to import; scripts need their declarations.
/// <reference path="../../src/shared/engine/physics/rapier-bg.d.ts" />
// oxlint-disable-next-line typescript/triple-slash-reference -- Ambient module scripts have no exports to import; scripts need their declarations.
/// <reference path="../../src/client/engine/boot/swGlobal.d.ts" />
import type { EngineProbe as ScriptProbe, HarnessPins as ScriptPins } from '../../src/client/engine/debug/probe';
import type { INPUT_CONTEXTS } from '../../src/client/game/inputContexts';

export type ScriptInputContexts = typeof INPUT_CONTEXTS;
export type { WsSw } from '../../src/client/engine/boot/sw';
export type { PrefetchHandle } from '../../src/client/engine/boot/shardPrefetch';
/** E357 F2: the runtime owns the contract, so scripts cannot silently drift from it. */
export type { EngineProbe as WildshardProbe } from '../../src/client/engine/debug/probe';
export type {
  HarnessPins, ProbeWorld, ProbePose, WalkLeg, WalkResult,
  Fingerprint, GameplayState, SoundLog, Saves, GpuBytes, CombatTarget, Vec3, ProbeNav,
} from '../../src/client/engine/debug/probe';

/** Capture scripts access these handles only after ws:ready. */
declare global { interface Window {
  __wildshard: ScriptProbe;
  __wildshardHarness?: ScriptPins;
  __frameFloorGridDocumentToken?: string;
  __frameFloorGridOriginDrift?: { deltaMs: number; maximumAbsoluteMs: number };
} }
