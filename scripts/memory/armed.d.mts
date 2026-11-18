export interface MemoryLines { playingBytes: number; loadingBytes: number }
export interface ArmedMemory { lines: MemoryLines; zones: Set<string>; readings: Map<string, MemoryLines> }
export interface PhoneFootprint { playing: number; loading: number }
export function parseArmedMemory(value: unknown): ArmedMemory;
export function armedMemory(): ArmedMemory;
export function footprintBootFor(zone: string, armed: ReadonlySet<string>, placed: ReadonlySet<string>): 'online' | 'standalone';
export function ledgerZones(available: readonly string[], armed: ReadonlySet<string>, requested?: readonly string[]): string[];
export function guardZone(zone: string, armed: ReadonlySet<string>, run: () => Promise<void>, log: (line: string) => void): Promise<void>;
export function phoneFootprint(zone: string, runs: readonly unknown[], model: unknown, boot: 'standalone' | 'online'): PhoneFootprint;
export function comparePhoneFootprint(reading: PhoneFootprint, lines: MemoryLines, armed?: MemoryLines): void;
