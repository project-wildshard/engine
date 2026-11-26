/** Source installed before any WebGL context or engine resource exists. */
export const GL_INIT: string;
/** Full render/draw label walks for explicit diagnostics; the allocation/census schema is identical. */
export const GL_FULL_INIT: string;
/** One live API allocation; zero-byte creations are included, deleted/context-lost ones are excluded. */
export interface GlResource { id: string; kind: 'texture' | 'renderbuffer' | 'buffer'; bytes: number; owner: string; asset: string; labelled: boolean }
export interface GlCensus { resources: GlResource[]; totalBytes: number; listedBytes: number; reconciled: boolean; unlabelled: number; texBytes: number; rbBytes: number; bufBytes: number }
export interface CensusObservation { contexts: GlCensus[]; assets: { owner: string; asset: string; bytes: number; resources: number }[]; totalBytes: number; listedBytes: number; unlabelled: number; reconciled: boolean; renderScale: number; canvas: number[]; viewport: number[]; renderer: string }
