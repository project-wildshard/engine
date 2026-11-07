import { Scope } from '@wildshard/engine/app/scope';
import { NetClient } from '@wildshard/engine/net/client';
import { Redial, type LinkState } from '@wildshard/engine/net/redial';
import { WebSocketTransport } from '@wildshard/engine/net/webSocketTransport';
import { reconnectStrip } from '../../src/client/host/online/reconnectStrip';

// E7.1b: the shipped client, link watch and strip, on a real browser's `WebSocket`. Only the page around them is a proof's.
const url = new URLSearchParams(location.search).get('ws') ?? '', scope = new Scope('strip.proof'), transport = new WebSocketTransport(url), client = new NetClient(transport);
const proof: { states: LinkState[]; frames: number; rejoins: number; welcome: string | null; rtt: number } = { states: [], frames: 0, rejoins: 0, welcome: null, rtt: 0 };
Object.assign(window, { proof });
const strip = reconnectStrip(scope, () => { redial.retry(); });
const redial = new Redial({ client, transport, dial: () => new WebSocketTransport(url), onState: state => { proof.states.push(state); strip(state); } });
client.onFrame(() => { proof.frames++; proof.welcome = client.welcome?.player ?? null; });
client.onRejoin(() => { proof.rejoins++; });
scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') redial.check(); });
client.hello('', { player: 'device:proof', name: 'Proof' });
scope.interval(16, () => { if (client.latest !== null) client.command({ steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); client.flush(); });
