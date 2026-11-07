import { saveEnvironment } from '../../../shared/engine/saves/environment';
import type { SaveStorage } from '../../../shared/engine/saves/store';
import { apiOrigin } from '../core/apiOrigin';

const KEY = 'crossroads.pending';
/** Retry a rig result on returning to the game, retaining it until the endpoint confirms persistence. */
export async function flushCrossroads(storage: SaveStorage | null = saveEnvironment().storage('device'), post: typeof fetch = fetch): Promise<void> {
  try {
    let raw = storage?.getItem(KEY);
    if (!raw || raw.length > 65_536) return;
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 6) return;
    const entries: unknown[] = value;
    const pending = entries.slice();
    while (pending.length > 0) {
      const record = pending[0];
      if (record === null || typeof record !== 'object' || !('kind' in record) || record.kind !== 'crossroads') return;
      const body = JSON.stringify(record);
      if (body.length > 16_384) return;
      const response = await post(`${apiOrigin()}/api/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
      if (!response.ok || storage?.getItem(KEY) !== raw) return;
      pending.shift(); raw = JSON.stringify(pending);
      if (pending.length > 0) storage.setItem(KEY, raw); else storage.removeItem(KEY);
    }
  } catch { /* Network/storage failure retains the result for the next boot or online event. */ }
}
