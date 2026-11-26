// CHUNK-PARAM CP5 (J522, Q3 (a)): the cell a page asks the world's door for goes in a word before its hello, never in an address.
import { Scope } from '../../../shared/engine/app/scope';
import { encodeGoto, worldReadsGoto, type GotoWord } from '../../../shared/engine/net/socketFrames';
import type { Transport } from '../../../shared/engine/net/transport';
import { WebSocketTransport } from './webSocketTransport';

/** CHUNK-PARAM CP5: how long a page with a cell to ask for waits for the door's first word before its hello goes alone. */
const GOTO_WAIT_MS = 3000;
/** GO7, CHUNK-PARAM CP5 (J522, Q3 (a)): a page Shard select sent to a grid cell says it in a `goto` word before its hello (never in
 *  the socket's address), once the door's first word says it reads one, and the door seats it there when it hosts that cell; any
 *  other page says nothing and takes the seat the world keeps (GO5). An older door, or no first word in time: the hello goes alone. */
export function gotoFirst(asked: () => GotoWord | undefined, waitMs: number = GOTO_WAIT_MS): (transport: Transport, hello: () => void) => void {
  return (transport, hello) => {
    const word = asked();
    if (word === undefined || !(transport instanceof WebSocketTransport)) { hello(); return; }
    const scope = new Scope('net.goto-first');
    const go = (bytes?: ArrayBuffer): void => {
      if (scope.disposed) return;
      scope.dispose();
      if (bytes !== undefined && worldReadsGoto(bytes)) transport.control('goto', encodeGoto(word));
      hello();
    };
    scope.onDispose(transport.onControl((control, bytes) => { if (control === 'world') go(bytes); }));
    scope.onDispose(transport.onClose(() => { scope.dispose(); }));
    scope.timeout(waitMs, () => { go(); });
  };
}
