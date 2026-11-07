// oxlint-disable-next-line import/no-nodejs-modules -- A real TCP proxy, which is the only honest way to pull a cable.
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

/** A localhost TCP proxy a test can cut without either end hearing it. */
export interface TcpPuller {
  readonly url: string;
  /** Stop every byte on every open link. Neither end is told: this is a phone in a tunnel. */
  pull: () => void;
  /** Links from here on carry bytes. Links that were cut stay cut. */
  restore: () => void;
  close: () => Promise<void>;
}
/** Forward `target`'s port. */
export async function tcpPuller(target: string): Promise<TcpPuller> {
  const { port, hostname } = new URL(target), open = new Set<Socket>();
  let cut = new Set<Socket>(), pulled = false;
  const pipe = (from: Socket, to: Socket): void => {
    from.on('data', data => { if (!cut.has(from)) to.write(data); });
    from.on('error', () => { to.destroy(); }); from.on('close', () => { open.delete(from); if (!cut.has(from)) to.destroy(); });
  };
  const server = createServer(near => {
    if (pulled) { near.destroy(); return; }
    const far = connect(Number(port), hostname);
    open.add(near); open.add(far);
    near.setNoDelay(); far.setNoDelay();
    pipe(near, far); pipe(far, near);
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const { port: own } = server.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${String(own)}`, pull: () => { pulled = true; cut = new Set(open); }, restore: () => { pulled = false; },
    close: async () => { for (const socket of open) socket.destroy(); await new Promise(resolve => { server.close(resolve); }); } };
}
