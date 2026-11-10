// The online chat row and its voice controls for scripts/hud-worst.mjs: the real modules (chatLines.ts, voiceUi.ts) over a stub
// link, so a built page that was never online draws them where a staging page does. Bundled per run into one IIFE; it reaches no
// network and no microphone.
import { Scope } from '../../src/shared/engine/app/scope.ts';
import { chatLines } from '../../src/client/host/online/chatLines.ts';
import { voiceUi } from '../../src/client/host/online/voiceUi.ts';
import type { VoiceChat, VoicePeer } from '../../src/client/host/online/voice.ts';
import type { NetClient } from '@wildshard/engine/net/client';

type Say = (said: { line: number; from: number; name: string; text: string }) => void;

/** Mount the row with `lines` said in it and voice `state` with `peers` on it; returns the scope that owns it all. */
function mount(lines: readonly (readonly [string, string])[], state: VoiceChat['state'], peers: readonly string[]): Scope {
  const scope = new Scope('hud-worst.chat');
  const heard: Say[] = [];
  const client = {
    welcome: { handle: 1 },
    onChat: (fn: Say): (() => void) => { heard.push(fn); return () => undefined; },
    say: (): void => undefined, report: (): void => undefined,
  } as unknown as NetClient;
  const roster = new Map<string, VoicePeer>(peers.map((name, i) => [`p${String(i)}`, { id: `p${String(i)}`, name, speaking: i === 0, muted: i === 2, linked: true }]));
  const voice = {
    state, speaking: true, level: 0.6, roster,
    onChange: (): (() => void) => () => undefined,
    toggle: (): void => undefined, mute: (): void => undefined,
  } as unknown as VoiceChat;
  const chat = chatLines(scope, client);
  voiceUi(scope, voice, chat);
  lines.forEach(([name, text], line) => { for (const fn of heard) fn({ line, from: line % 2 === 0 ? 2 : 1, name, text }); });
  return scope;
}

(globalThis as { __hudWorstChat?: typeof mount }).__hudWorstChat = mount;
