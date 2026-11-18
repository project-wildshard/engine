// MEMORY-STRUCTURE STR4 (J414): on a DEVSERVER page joined to a dev server (`pnpm dev`, `wildshard dev`), the harness verbs and
// the dev hook's colliders and ground go to the server's control channel (`server/host/dedicated/devControl.ts`), as the in-page
// server's harness port carried them. The online shell reaches this only behind the `__DEVSERVER__` define.
import type { DevBox, DevGround } from '@wildshard/engine/game/devColliders';

/** The dev server's answer. */
export interface DevControlAnswer { readonly ok: boolean; readonly reason?: string; readonly tick?: number }

/** The control channel beside a world's socket address: the same host and port, over HTTP. */
export function devControlUrl(socket: string): string {
  const url = new URL(socket);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/__dev/control'; url.search = ''; url.hash = '';
  return url.href;
}

/** What a dev page's online shell says to its dev server. */
export interface DevControls {
  readonly send: (message: object) => Promise<DevControlAnswer>;
  readonly place: (x: number, y: number, z: number, yaw: number) => void;
  readonly hardHits: (by: number) => void;
  readonly bossGod: () => void;
  readonly still: () => void;
  readonly raise: (flag: string) => void;
  readonly move: (device: string, x: number, y: number, z: number) => void;
  readonly devColliders: (name: string, boxes: readonly DevBox[]) => void;
  readonly devGround: (ground: DevGround) => void;
}

/** The controls for this page's `device`, on the world its socket address names now. */
export function devControls(address: () => string, device: string): DevControls {
  const send = async (message: object): Promise<DevControlAnswer> => {
    try {
      const response = await fetch(devControlUrl(address()), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...message, device }) });
      const answer: unknown = await response.json();
      return typeof answer === 'object' && answer !== null && 'ok' in answer && typeof answer.ok === 'boolean' ? answer as DevControlAnswer : { ok: false, reason: `status ${String(response.status)}` };
    } catch (cause) { return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) }; }
  };
  const told = (message: object): void => { void (async (): Promise<void> => { const answer = await send(message); if (!answer.ok) console.warn('[dev control]', answer.reason); })(); };
  return { send,
    place: (x, y, z, yaw) => { told({ x, y, z, yaw }); }, hardHits: by => { told({ hits: by }); }, bossGod: () => { told({ god: true }); },
    still: () => { told({ still: true }); }, raise: flag => { told({ flag }); }, move: (other, x, y, z) => { told({ move: other, x, y, z, yaw: 0 }); },
    devColliders: (name, boxes) => { told({ wildshardDevColliders: name, boxes }); }, devGround: ground => { told({ wildshardDevGround: ground }); } };
}
