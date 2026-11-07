import { beforeEach, vi } from 'vitest';
import { ENGINE_CONTENT_STRINGS } from '../src/client/game/engineStrings';
import { installEngineStrings } from '../src/shared/engine/strings';
import { installAppIdentity } from '../src/shared/engine/app/identity';
import { WILDSHARD_IDENTITY } from '../src/client/game/identity';

/** Browser globals and strings only; content installs belong to explicit world fixtures. */
export class MemoryStorage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

installEngineStrings(ENGINE_CONTENT_STRINGS);
vi.stubGlobal('localStorage', new MemoryStorage());
vi.stubGlobal('location', new URL('http://localhost:5173/'));
// Identity/save/frame hosts are the environment, not world content.
await import('../src/client/app/identity');
// Historical fixtures explicitly exercise epoch zero. Epoch tests install the
// release identity themselves; production always installs it from app/identity.
installAppIdentity({ ...WILDSHARD_IDENTITY, saveEpoch: 0, savePrefix: 'wildshard.save.v2.' });

beforeEach(() => { localStorage.clear(); });
