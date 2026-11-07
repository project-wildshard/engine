// Compiler-derived from test/fixtures/legacy-oracles/nalati-ambience.json; sha256 2af653870aeb74af590358b940e0eac68ea31a41842e1480ba55c837729f8a97.
// Refresh: node scripts/json-declarations.mjs
declare const value: { source: string; sets: { frame: number; mixes: { id: string; gain: number; tau: number; panned: boolean; }[]; pans: number[][]; diag: { "steppe-wind": number; "steppe-larks": number; "steppe-night": number; river: number; meltwater: number; camp: number; highwind: number; coldwind: number; rain: number; stormwind: number; valley: number; bowl: number; snow: number; sampled: number; calls: number; }; }[]; calls: { frame: number; calls: { kind: string; point: number[]; listener: number[]; yaw: number; }[]; }[]; zones: (string | number)[][]; };
// oxlint-disable-next-line import/no-default-export -- native JSON requires its default import contract
export default value;
