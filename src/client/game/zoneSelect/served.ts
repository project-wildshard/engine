import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { saveEnvironment } from '@wildshard/engine/saves/environment';
import type { ActorTags } from '@wildshard/engine/app/actor';
import { ZONE_SELECT_PRESS_PATH, ZoneSelectSchema, type ZoneSelectDocument } from '@wildshard/engine/game/grid/zoneSelectRows';
import { pageActor } from '@wildshard/engine/telemetry/pageActor';
import { buildCodeFolder } from '@wildshard/engine/boot/codeFolder';
import { WILDSHARD_IDENTITY } from '../identity';

const DEADLINE_MS = 1500;
const MAX_CHARS = 128 * 1024;
interface WorldStamp { readonly release: string; readonly key: string }
interface ZoneSelectLocation { readonly url: string; readonly channel: ZoneSelectDocument['channel'] }
interface SourcePorts {
  readonly fetch: typeof fetch;
  readonly locate: (world: WorldStamp, deadline: number) => Promise<ZoneSelectLocation | null>;
  readonly pressPage?: () => { readonly origin: string; readonly actor: ActorTags; readonly now: number };
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
  const door = await import(/* @vite-ignore */ `${buildCodeFolder()}/standalone/online.js`) as {
    readonly zoneSelectLocation?: SourcePorts['locate'];
  };
  return await door.zoneSelectLocation?.(world, deadline) ?? null;
}

const browserPorts: SourcePorts = {
  fetch, locate,
  pressPage: () => ({ origin: window.location.origin, actor: pageActor(), now: diagnosticNow() }),
};

export interface ZoneSelectSource {
  initial: () => ZoneSelectDocument | null;
  refresh: () => Promise<ZoneSelectDocument | null>;
  press: (slug: string) => void;
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
  const recentPresses = new Map<string, number>();
  let locating: Promise<ZoneSelectLocation | null> | undefined;
  function address(worldToLocate: WorldStamp): Promise<ZoneSelectLocation | null> {
    locating ??= Promise.resolve().then(() => ports.locate(worldToLocate, deadline)).catch(() => null).then(source => {
      if (source === null) locating = undefined;
      return source;
    });
    return locating;
  }
  function kept(): ZoneSelectDocument | null {
    if (storageKey === undefined) return null;
    try { return parse(saveEnvironment().storage('device')?.getItem(storageKey)); } catch { return null; }
  }
  async function refresh(): Promise<ZoneSelectDocument | null> {
    if (world === undefined || storageKey === undefined) return null;
    const scope = new Scope('zone-select.live'), abort = new AbortController();
    const timeout = new Promise<null>(resolve => { scope.timeout(deadline, () => { abort.abort(); resolve(null); }); });
    const read = async (): Promise<ZoneSelectDocument | null> => {
      const source = await address(world);
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
  /** The button's observation is independent of the world check and of navigation. */
  function press(slug: string): void {
    if (world === undefined) return;
    const reading = ports.pressPage?.();
    const channel = reading === undefined ? undefined : WILDSHARD_IDENTITY.errorReportEnvironments?.[reading.origin];
    if (reading === undefined || (channel !== 'staging' && channel !== 'production')) return;
    const { actor, now } = reading;
    if (now - (recentPresses.get(slug) ?? -Infinity) < 2000) return;
    recentPresses.set(slug, now);
    void (async (): Promise<void> => {
      const source = await address(world);
      if (source?.channel !== channel) return;
      const at = new URL(ZONE_SELECT_PRESS_PATH, source.url);
      if (at.protocol !== 'https:') return;
      if (actor.actor === 'agent') at.searchParams.set('agent', actor.lane ?? '1');
      const request = ports.fetch;
      // A plain string keeps this a simple CORS POST. Never put the agent header on cross-origin requests.
      const reply = await request(at.href, { method: 'POST', keepalive: true, credentials: 'omit', redirect: 'error',
        body: JSON.stringify({ slug, channel, audience: actor.actor === 'agent' ? 'automation' : 'human' }) });
      await reply.body?.cancel();
    })().catch(() => undefined);
  }
  return { initial: () => kept() ?? baked, refresh, press };
}
