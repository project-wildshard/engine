import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { saveEnvironment } from '@wildshard/engine/saves/environment';
import { ZoneSelectSchema, type ZoneSelectDocument } from '@wildshard/engine/game/grid/zoneSelectRows';

const DEADLINE_MS = 1500;
const MAX_CHARS = 128 * 1024;
interface WorldStamp { readonly release: string; readonly key: string }
interface ZoneSelectLocation { readonly url: string; readonly channel: ZoneSelectDocument['channel'] }
interface SourcePorts {
  readonly fetch: typeof fetch;
  readonly locate: (world: WorldStamp, deadline: number) => Promise<ZoneSelectLocation | null>;
}

function worldStamp(value: unknown): WorldStamp | undefined {
  if (value === null || typeof value !== 'object' || !('release' in value) || !('key' in value)) return undefined;
  return typeof value.release === 'string' && typeof value.key === 'string' ? { release: value.release, key: value.key } : undefined;
}

function parse(text: string | null | undefined): ZoneSelectDocument | null {
  if (!text || text.length > MAX_CHARS) return null;
  try {
    const parsed = v.safeParse(ZoneSelectSchema, JSON.parse(text));
    return parsed.success ? parsed.output : null;
  } catch { return null; }
}

async function locate(world: WorldStamp, deadline: number): Promise<ZoneSelectLocation | null> {
  const build = (globalThis as { __WS_BUILD_ID__?: string }).__WS_BUILD_ID__ ?? '';
  const door = await import(/* @vite-ignore */ `/b/${build}/standalone/online.js`) as {
    readonly zoneSelectLocation?: SourcePorts['locate'];
  };
  return await door.zoneSelectLocation?.(world, deadline) ?? null;
}

const browserPorts: SourcePorts = { fetch, locate };

export interface ZoneSelectSource {
  initial: () => ZoneSelectDocument | null;
  refresh: () => Promise<ZoneSelectDocument | null>;
}

/** Paint the kept list or baked staging snapshot synchronously. A rejected or late fetch leaves it in place. */
export function zoneSelectSource(
  page: Pick<Document, 'getElementById'>,
  stamp: unknown,
  ports: SourcePorts = browserPorts,
  deadline: number = DEADLINE_MS,
): ZoneSelectSource {
  const world = worldStamp(stamp);
  const storageKey = world === undefined ? undefined : `ws-zone-select:${world.release}`;
  const baked = parse(page.getElementById('ws-zone-select')?.textContent);
  function kept(): ZoneSelectDocument | null {
    if (storageKey === undefined) return null;
    try { return parse(saveEnvironment().storage('device')?.getItem(storageKey)); } catch { return null; }
  }
  async function refresh(): Promise<ZoneSelectDocument | null> {
    if (world === undefined || storageKey === undefined) return null;
    const scope = new Scope('zone-select.live'), abort = new AbortController();
    const timeout = new Promise<null>(resolve => { scope.timeout(deadline, () => { abort.abort(); resolve(null); }); });
    const read = async (): Promise<ZoneSelectDocument | null> => {
      const source = await ports.locate(world, deadline);
      if (source === null || abort.signal.aborted) return null;
      const request = ports.fetch;
      const reply = await request(source.url, { credentials: 'omit', redirect: 'error', signal: abort.signal });
      if (!reply.ok) { await reply.body?.cancel(); return null; }
      const live = parse(await reply.text());
      if (live?.channel !== source.channel || abort.signal.aborted) return null;
      const prior = kept();
      if (prior?.channel === live.channel && prior.serial > live.serial) return null;
      try { saveEnvironment().storage('device')?.setItem(storageKey, JSON.stringify(live)); } catch { /* storage can be disabled */ }
      return live;
    };
    try { return await Promise.race([read(), timeout]); } catch { return null; }
    finally { scope.dispose(); }
  }
  return { initial: () => kept() ?? baked, refresh };
}
