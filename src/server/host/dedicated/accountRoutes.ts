// oxlint-disable-next-line import/no-nodejs-modules -- the door's HTTP server hands these routes its request and response.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountExport } from './saves/account';
import { confirmed } from './ticket';

// MMO-PLAN MP2.5a (delete and export): a signed-in page's own data, from the door. `POST /account/export` answers everything the
// saves database holds for the account; `POST /account/delete` deletes it, leaving anonymous ledger rows only (`saves/account.ts`).
// The proof is a live confirm in `Authorization: Ticket <confirm>`, checked offline against the pinned key (`ticket.ts`): the API mints
// one, five minutes long, only for a live session (MP2.5e, review S3). A join ticket (an hour long, in every hello), a guest id, a
// dead confirm or one another key signed gets 401. Only the game's pages may ask from a browser (the WebSocket's `ALLOWED_ORIGINS`).
// An account still in the world (a body linked, held, loading or crossing) can't be deleted: 409, play leaves first. Neither the
// ticket nor the account is ever logged.

/** What the routes read. */
export interface AccountRoutes {
  readonly ticketKey: string;
  /** The game's pages; null lets any Origin in (`ALLOWED_ORIGINS=*`). */
  readonly allowedOrigins: readonly string[] | null;
  /** Hold the seat out of the world for a delete: the release, or undefined while it is playing (linked, joining, held, loading or crossing). */
  readonly hold: (seat: string) => (() => void) | undefined;
  readonly exportAccount: (account: string) => Promise<AccountExport | undefined>;
  readonly deleteAccount: (account: string) => Promise<boolean>;
  readonly log: (line: Record<string, unknown>) => void;
  /** After a delete: the door forgets what it knew of the account (a settled claim). */
  readonly deleted?: (account: string) => void;
}

const PATHS = new Set(['/account/export', '/account/delete']);
const TICKET = /^Ticket (?<ticket>\S{1,255})$/u;

/** The routes as one handler; false for any other request. */
export function accountRoutes(options: AccountRoutes): (request: IncomingMessage, response: ServerResponse) => boolean {
  return (request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (!PATHS.has(path)) return false;
    const origin = request.headers.origin, allowed = origin === undefined || options.allowedOrigins === null || options.allowedOrigins.includes(origin);
    const cors: Record<string, string> = origin !== undefined && allowed ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
    const send = (status: number, body?: unknown): void => {
      response.writeHead(status, { ...cors, 'cache-control': 'no-store', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }).end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (!allowed) { send(403, { error: 'not a game page' }); return true; }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...cors, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization', 'access-control-max-age': '600' }).end();
      return true;
    }
    if (request.method !== 'POST') { send(405, { error: 'POST only' }); return true; }
    request.resume(); // no body is read
    void (async (): Promise<void> => {
      const ticket = TICKET.exec(request.headers.authorization ?? '')?.groups?.['ticket'] ?? '';
      const account = await confirmed(ticket, options.ticketKey, Date.now());
      if (account === undefined) { send(401, { error: 'sign in again' }); return; }
      const action = path === '/account/export' ? 'export' : 'delete';
      try {
        if (action === 'export') { const data = await options.exportAccount(account); send(data === undefined ? 404 : 200, data ?? { error: 'nothing saved' }); return; }
        const release = options.hold(account);
        if (release === undefined) { send(409, { error: 'leave the world first' }); return; }
        let deleted: boolean;
        try { deleted = await options.deleteAccount(account); options.deleted?.(account); } finally { release(); }
        options.log({ at: 'account.deleted', found: deleted });
        send(200, { deleted });
      } catch (error) {
        // the database's message can quote the account id, which is never logged: the error's class only
        options.log({ at: 'account.failed', action, error: error instanceof Error ? (error.message === 'Player save is pending' ? 'save-pending' : error.name) : typeof error });
        send(503, { error: 'try again later' });
      }
    })();
    return true;
  };
}
