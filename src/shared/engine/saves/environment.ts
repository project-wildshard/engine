import type { SaveScope, SaveStorage } from './store';

export interface SaveEnvironment {
  storage: (scope: SaveScope) => SaveStorage | null;
  persistent: () => boolean;
  persist: () => Promise<boolean>;
  standalone?: () => boolean;
}
const memoryOnly: SaveEnvironment = { storage: () => null, persistent: () => false, persist: () => Promise.resolve(false) };
let environment = memoryOnly;
/** The composition root installs browser services; a headless host uses explicit storage or the memory default. */
export function installSaveEnvironment(value: SaveEnvironment): void { environment = value; }
export function saveEnvironment(): SaveEnvironment { return environment; }
