import { Scope } from '@wildshard/engine/app/scope';
import { NetClient } from '@wildshard/engine/net/client';
import { Redial, type LinkState } from '@wildshard/engine/net/redial';
import { WebSocketTransport } from '@wildshard/engine/net/webSocketTransport';
import { linkScreens } from '../../src/client/host/online/linkScreens';

// E7.1b, FM4: the shipped client, link watch and screens, on a real browser's `WebSocket`. Only the page around them is a proof's.
const url = new URLSearchParams(location.search).get('ws') ?? '', scope = new Scope('strip.proof'), transport = new WebSocketTransport(url), client = new NetClient(transport);
const proof: { states: LinkState[]; frames: number; rejoins: number; welcome: string | null; rtt: number; said: string[]; heard: string[] } = { states: [], frames: 0, rejoins: 0, welcome: null, rtt: 0, said: [], heard: [] };
Object.assign(window, { proof });
const screens = linkScreens(scope, { retry: () => { redial.retry(); }, dialNow: () => { redial.dialNow(); }, progress: () => redial.progress, why: () => redial.why, reload: () => undefined });
const redial = new Redial({ client, transport, dial: () => new WebSocketTransport(url), onState: (state, reason) => { proof.states.push(state); screens.link(state, reason); } });
client.gateActions(what => screens.allow(what));
// the proof's taps: an act the world must hear, and a chat line
Object.assign(window, { tap: (): void => { client.act({ kind: 'interact', seq: 0, id: 'proof' }); }, say: (text: string): void => { if (!screens.holdChat(text, line => { proof.said.push(line); client.say('room', line); }, () => undefined)) { proof.said.push(text); client.say('room', text); } } });
// what came back through the server's room chat: the held line must arrive once
client.onChat(({ text }) => { proof.heard.push(text); });
client.onFrame(() => { proof.frames++; proof.welcome = client.welcome?.player ?? null; });
client.onRejoin(() => { proof.rejoins++; });
scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') { redial.check(); screens.visible(); } });
client.hello('', { player: 'device:proof', name: 'Proof' });
scope.interval(16, () => { if (client.latest !== null) client.command({ steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); client.flush(); });
