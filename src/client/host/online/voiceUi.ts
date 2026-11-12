import type { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { listenPage } from '@wildshard/engine/input/dom';
import type { ChatBox } from './chatLines';
import { cornerShown } from './chatCorner';
import { voicePrefs, type VoiceChat, type VoicePeer, type VoiceState } from './voice';
import { voiceTalkKey, voiceTalkKeys } from '@wildshard/engine/ui/voiceSettings';

// J218: voice's controls live in the chat row, so the one mic button is both the phone's HUD toggle and the prompt "near the
// chat". On a keyboard `B` toggles it (no binding uses B: `src/client/game/inputContexts.ts`). Over the row, one tip says
// what to do next. QA row 43 (Jake, 2026-11-10: "get rid of these icons for team members … just have chat and the little
// microphone button"): the players on voice are no longer chips in the corner. They are a list in the open chat (chatLines.ts),
// one row each, that glows as they talk and mutes on a tap, so per-player mute is never lost.
// QA row 6 (Jake, 2026-11-10: "B to talk doesnt seem to give any feedback"): every press says what happened. Turning voice
// off says so for a moment, a tip the player closed comes back on the next press, a browser with no voice says that, and B
// out of play (the loading card, the title, an open menu) does nothing, because the mic it would open is hidden there (QA row 15,
// QA 2026-11-11). The first-time tip's 15 s start when the corner first shows, so it is not spent under the loading card.
// Only online worlds say anything: a single-player page has no voice and B there stays silent (Jake, 2026-11-10: "we
// don't have to show a banner in single player about there being no voice chat … Just don't do that").
// VOICE-POLISH V10, V11: the key is the `voice.talk` binding (B unless rebound in Controls ▸ Key bindings, a mouse side button
// too), and in Settings' hold mode it opens the mic only while held: the button stays the tap toggle for joining and leaving.

const CYAN = '#8fe3ff', NAVY = 'rgba(9,22,36,.86)', RED = '#ff7a7a', AMBER = '#ffc56b';
/** The first-time tip, the "you're on, alone" tip and the "voice off" tip go after this long. */
const FIRST_TIP_MS = 15_000, ALONE_TIP_MS = 5000, OFF_TIP_MS = 3000;
const CSS = `
#ws-voice{flex:none;position:relative;width:38px;height:38px;border-radius:50%;border:1.5px solid rgba(143,227,255,.5);background:${NAVY};color:#9fb3c8;display:grid;place-items:center;padding:0;pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:box-shadow .12s,background .2s,border-color .2s}
#ws-voice svg{width:20px;height:20px}
#ws-voice[data-state=asking],#ws-voice[data-state=joining]{color:${CYAN};border-color:${CYAN};animation:ws-voice-pulse 1s ease-in-out infinite}
#ws-voice[data-state=on]{color:#04121d;background:${CYAN};border-color:${CYAN}}
#ws-voice[data-state=on][data-ptt=idle]{color:${CYAN};background:${NAVY}}
#ws-voice[data-state=denied],#ws-voice[data-state=failed]{color:${RED};border-color:${RED}}
#ws-voice[data-state=full]{color:${AMBER};border-color:${AMBER}}
#ws-voice .ws-voice-key{position:absolute;right:-5px;bottom:-5px;min-width:14px;padding:0 2px;white-space:nowrap;height:14px;border-radius:3px;background:#0b1a2a;border:1px solid rgba(143,227,255,.6);color:${CYAN};font:700 9px/13px system-ui,sans-serif;text-align:center}
@keyframes ws-voice-pulse{50%{box-shadow:0 0 0 5px rgba(143,227,255,.25)}}
#ws-voice-tip{display:flex;gap:8px;align-items:center;align-self:flex-start;max-width:100%;padding:5px 6px 5px 9px;border-radius:8px;background:rgba(6,16,28,.9);border:1px solid rgba(143,227,255,.35);color:#dff6ff;font:600 12px/1.3 system-ui,sans-serif;pointer-events:auto}
#ws-voice-tip[data-tone=bad]{border-color:rgba(255,122,122,.6)}
#ws-voice-tip button{flex:none;border:0;background:none;color:#9fb3c8;font:inherit;font-size:14px;padding:0 4px;cursor:pointer}
#ws-voice-peers{display:flex;flex-direction:column;gap:4px;pointer-events:auto}
#ws-voice-peers>[data-title]{color:#9fb3c8;font:700 10px/1.2 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:0 4px 2px}
#ws-voice-peers button{display:flex;gap:8px;align-items:center;width:100%;min-height:36px;padding:4px 10px 4px 8px;border-radius:8px;border:1px solid rgba(143,227,255,.25);background:rgba(8,14,24,.7);color:#dff6ff;font:600 13px/1.2 system-ui,sans-serif;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:box-shadow .12s,border-color .12s}
#ws-voice-peers button i{flex:none;width:8px;height:8px;border-radius:50%;background:#4a6378}
#ws-voice-peers button span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ws-voice-peers button em{flex:none;font-style:normal;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${CYAN};padding:3px 8px;border-radius:999px;border:1px solid rgba(143,227,255,.4)}
#ws-voice-peers button[data-linked=true] i{background:#5fd3a0}
#ws-voice-peers button[data-speaking=true]{border-color:${CYAN};box-shadow:0 0 0 2px rgba(143,227,255,.45),0 0 10px rgba(143,227,255,.5)}
#ws-voice-peers button[data-speaking=true] i{background:${CYAN}}
#ws-voice-peers button[data-muted=true] span{color:#7d8d9c;text-decoration:line-through}
#ws-voice-peers button[data-muted=true] em{color:${RED};border-color:rgba(255,122,122,.5)}
#ws-voice-peers button[data-linked=false]{opacity:.6}
#ws-voice-peers button[data-far=true]{opacity:.6}
#ws-voice-peers button[data-far=true] span::after{content:' · too far';color:#7d8d9c;font-weight:500}
#ws-voice-tip[hidden],#ws-voice-peers[hidden]{display:none}
`;
const MIC = '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>';
const icon = (slashed: boolean): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${MIC}${slashed ? '<path d="M4 4l16 16"/>' : ''}</svg>`;
const touchFirst = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** How to let the mic back in, in the words of the browser this is. */
function deniedHelp(): string {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/u.test(agent) || (/Macintosh/u.test(agent) && touchFirst())) return 'Microphone blocked. Tap aA in the address bar, Website Settings, Microphone: Allow. Then tap the mic again.';
  if (/Android/u.test(agent)) return 'Microphone blocked. Tap the icon left of the address, Permissions, Microphone: Allow. Then tap the mic again.';
  return `Microphone blocked. Click the icon left of the address, allow the Microphone, then press ${voiceTalkKey()} again.`;
}
/** Whether a key is the talk key: its code, or a sided key bound either side (`Shift` for `ShiftLeft`). */
const isTalkKey = (code: string): boolean => { const keys = voiceTalkKeys(); return keys.includes(code) || keys.includes(code.replace(/(?:Left|Right)$/u, '')); };
/** A press of the talk key that is meant for voice: not typed into a field, not a repeat, not a shortcut, and only in play. */
function voiceKey(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  const self = event.code.replace(/(?:Left|Right)$/u, '');
  // A shortcut is not a press, unless the modifier held is the talk key itself (talk on Alt).
  if (!isTalkKey(event.code) || event.repeat || (event.ctrlKey && self !== 'Control') || (event.metaKey && self !== 'Meta') || (event.altKey && self !== 'Alt')) return false;
  if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return false;
  return cornerShown(document.documentElement.dataset);
}
/** A browser with no WebRTC or no mic API: no mic button, and B says why for a moment. */
function noVoice(scope: Scope, chat: ChatBox): void {
  const tip = document.createElement('div'), text = document.createElement('span');
  tip.id = 'ws-voice-tip'; tip.dataset['tone'] = 'bad'; tip.dataset['key'] = 'unsupported'; tip.hidden = true;
  text.textContent = 'Voice chat doesn\'t work in this browser. Text chat still does.'; tip.append(text); chat.box.append(tip);
  let shownAt = -Infinity;
  listenPage(scope, 'keydown', event => { if (voiceKey(event)) { tip.hidden = false; shownAt = diagnosticNow(); } }, { capture: true });
  scope.interval(500, () => { if (tip.hidden !== true && diagnosticNow() - shownAt > OFF_TIP_MS + 1000) tip.hidden = true; });
}
const names = (peers: readonly VoicePeer[]): string => peers.length === 1 ? `${peers[0]?.name ?? 'Someone'} is` : peers.length === 2 ? `${peers[0]?.name ?? ''} and ${peers[1]?.name ?? ''} are` : `${String(peers.length)} players are`;

/** Put voice's controls in the chat box, and `B` on the keyboard. */
export function voiceUi(scope: Scope, voice: VoiceChat, chat: ChatBox): void {
  const style = scope.ownNode(document.createElement('style'));
  style.textContent = CSS; document.head.append(style);
  if (voice.state === 'unsupported') { noVoice(scope, chat); return; }
  const button = document.createElement('button'), tip = document.createElement('div'), peers = document.createElement('div');
  button.id = 'ws-voice'; button.type = 'button';
  tip.id = 'ws-voice-tip'; peers.id = 'ws-voice-peers';
  const heading = document.createElement('div');
  heading.dataset['title'] = ''; heading.textContent = 'On voice · tap to mute'; peers.append(heading);
  chat.form.append(button); chat.box.append(tip, peers);
  const touch = touchFirst(), act = (): string => touch ? 'Tap the mic' : `${voice.mode === 'hold' ? 'Hold' : 'Press'} ${voiceTalkKey()}`;
  // the first-time tip's clock starts when the corner first shows (NaN: not yet)
  let dismissed = '', firstUntil = voicePrefs.read().seen ? 0 : Number.NaN, aloneUntil = 0, offUntil = 0, was: VoiceState = voice.state;
  const seen = (): void => { voicePrefs.write({ seen: true }); firstUntil = 0; };
  // A press is a fresh question: whatever it leads to shows, even a tip the player closed before (a second "blocked").
  const pressed = (): void => { seen(); dismissed = ''; voice.toggle(); };
  scope.listen(button, 'click', event => { event.preventDefault(); pressed(); button.blur(); });
  // V11: the key presses (toggle mode: on or off; hold mode: open while held), and its release closes a held mic wherever focus is
  const press = (): void => { seen(); dismissed = ''; voice.press(); };
  listenPage(scope, 'keydown', event => { if (voiceKey(event)) press(); }, { capture: true });
  listenPage(scope, 'keyup', event => { if (isTalkKey(event.code)) voice.release(); }, { capture: true });
  listenPage(scope, 'pointerdown', event => { if (event instanceof PointerEvent && event.pointerType === 'mouse' && isTalkKey(`Mouse${String(event.button)}`) && cornerShown(document.documentElement.dataset)) press(); }, { capture: true });
  listenPage(scope, 'pointerup', event => { if (event instanceof PointerEvent && event.pointerType === 'mouse' && isTalkKey(`Mouse${String(event.button)}`)) voice.release(); }, { capture: true });
  scope.listen(window, 'blur', () => { voice.release(); });
  scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') voice.release(); });

  const tipFor = (): { key: string; text: string; tone: 'ok' | 'bad' } | null => {
    const others = [...voice.roster.values()], now = diagnosticNow();
    if (Number.isNaN(firstUntil) && chat.shown()) firstUntil = now + FIRST_TIP_MS;
    const { state } = voice;
    if (state === 'asking') return { key: 'asking', text: 'Allow the microphone when your browser asks.', tone: 'ok' };
    if (state === 'joining') return { key: 'joining', text: 'Joining voice…', tone: 'ok' };
    if (state === 'denied') return { key: 'denied', text: deniedHelp(), tone: 'bad' };
    if (state === 'failed') return { key: 'failed', text: 'No microphone was found. Check it is plugged in and allowed.', tone: 'bad' };
    if (state === 'full') return { key: 'full', text: 'Voice is full here: 8 players are on it already.', tone: 'bad' };
    if (state === 'on') return others.length === 0 && now < aloneUntil ? { key: 'alone', text: voice.mode === 'hold' && !touch ? `You're on voice. Hold ${voiceTalkKey()} to talk.` : 'You\'re on voice. Players here hear you once they join.', tone: 'ok' } : null;
    if (state !== 'off') return null;
    if (now < offUntil) return { key: 'off', text: `Voice off. ${act()} to talk again.`, tone: 'ok' };
    if (others.length > 0) return { key: `join:${others.map(peer => peer.id).join(',')}`, text: `${names(others)} on voice. ${act()} to join.`, tone: 'ok' };
    if (now < firstUntil) return { key: 'first', text: touch ? 'Tap the mic to talk with players here.' : `${act()} (or click the mic) to talk with players here.`, tone: 'ok' };
    return null;
  };
  let drawnOff: string | null = null, drawnTip: string | null = null;
  const chips = new Map<string, { readonly chip: HTMLButtonElement; readonly label: HTMLSpanElement; readonly action: HTMLElement }>();
  const chipFor = (peer: VoicePeer): HTMLButtonElement => {
    let held = chips.get(peer.id);
    if (held === undefined) {
      const chip = document.createElement('button'), dot = document.createElement('i'), label = document.createElement('span'), action = document.createElement('em');
      chip.type = 'button'; chip.dataset['peer'] = peer.id; chip.append(dot, label, action);
      scope.listen(chip, 'click', () => { const now = voice.roster.get(peer.id); if (now !== undefined) voice.mute(peer.id, !now.muted); });
      held = { chip, label, action }; chips.set(peer.id, held);
    }
    const { chip, label, action } = held;
    chip.dataset['speaking'] = String(peer.speaking); chip.dataset['muted'] = String(peer.muted); chip.dataset['linked'] = String(peer.linked); chip.dataset['far'] = String(peer.far);
    chip.title = peer.muted ? `Unmute ${peer.name}` : `Mute ${peer.name}`;
    label.textContent = peer.name; action.textContent = peer.muted ? 'Muted' : 'Mute';
    chip.setAttribute('aria-pressed', String(peer.muted));
    return chip;
  };
  /** Draw what changed; a button or chip being tapped is never swapped out from under the finger. */
  const render = (): void => {
    if (voice.state === 'on' && was !== 'on') aloneUntil = diagnosticNow() + ALONE_TIP_MS;
    if (voice.state === 'off' && (was === 'on' || was === 'joining' || was === 'asking')) offUntil = diagnosticNow() + OFF_TIP_MS;
    was = voice.state;
    const off = voice.state !== 'on' && voice.state !== 'asking' && voice.state !== 'joining';
    button.dataset['state'] = voice.state;
    if (voice.mode === 'hold' && !touch) button.dataset['ptt'] = voice.sending ? 'held' : 'idle'; else delete button.dataset['ptt'];
    const key = touch ? '' : voiceTalkKey();
    if (`${String(off)}|${key}` !== drawnOff) {
      drawnOff = `${String(off)}|${key}`;
      button.innerHTML = icon(off);
      if (!touch) { const badge = document.createElement('span'); badge.className = 'ws-voice-key'; badge.textContent = key; button.append(badge); }
      button.setAttribute('aria-label', off ? 'Turn voice on' : 'Turn voice off');
      button.setAttribute('aria-pressed', String(!off));
    }
    button.style.boxShadow = voice.sending && voice.speaking ? `0 0 0 ${String(2 + Math.round(voice.level * 6))}px rgba(143,227,255,.45)` : '';
    button.dataset['speaking'] = String(voice.state === 'on' && voice.speaking);
    const said = tipFor(), shown = said === null || said.key === dismissed ? null : said;
    if ((shown === null ? '' : `${shown.key}|${shown.text}`) !== drawnTip) {
      drawnTip = shown === null ? '' : `${shown.key}|${shown.text}`;
      tip.hidden = shown === null;
      if (shown !== null) {
        tip.dataset['tone'] = shown.tone; tip.dataset['key'] = shown.key.split(':')[0] ?? shown.key;
        const text = document.createElement('span'), close = document.createElement('button');
        text.textContent = shown.text; close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss');
        scope.listen(close, 'click', () => { dismissed = shown.key; if (shown.key === 'first') seen(); render(); });
        tip.replaceChildren(text, close);
      }
    }
    for (const id of chips.keys()) if (!voice.roster.has(id)) { chips.get(id)?.chip.remove(); chips.delete(id); }
    peers.hidden = voice.state !== 'on' || voice.roster.size === 0;
    for (const peer of voice.roster.values()) { const chip = chipFor(peer); if (chip.parentElement !== peers) peers.append(chip); }
  };
  scope.onDispose(voice.onChange(render));
  // The first-time and alone tips time out on their own.
  scope.interval(1000, render);
  render();
}
