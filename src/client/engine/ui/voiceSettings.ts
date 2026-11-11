import * as v from 'valibot';
import { saves } from '../../../shared/engine/saves/runtime';
import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';
import { listenTap } from '../input/dom';
import { keycap } from '../input/keycap';
import { app } from '../app/runtime';
import type { Action } from '../input/InputService';

// VOICE-POLISH V10 (meta docs/plans/VOICE-POLISH-PLAN.md): Settings ▸ Sound ▸ Voice. Which microphone voice opens, how loud the
// other players are, and on a keyboard whether the talk key toggles the mic or opens it only while held (V11). The key itself is
// the `voice.talk` action, rebound in Controls ▸ Key bindings like any other. Voice chat (src/client/host/online/voice.ts) reads
// these live: a new microphone is swapped in mid-call, and the volume applies on its next 150 ms poll.

/** The talk key's action: `B` on foot (src/client/game/inputContexts.ts). */
export const VOICE_TALK: Action = 'voice.talk';
/** `toggle`: a press turns voice on or off. `hold`: voice stays joined, and the mic is open only while the key is held. */
export type VoiceMode = 'toggle' | 'hold';
export interface VoiceSettings {
  /** A microphone's `deviceId`; empty is the browser's default. */
  readonly input: string;
  /** How loud the other players are, 0 to 1, before distance (V7). */
  readonly volume: number;
  readonly mode: VoiceMode;
}
const DEFAULTS: VoiceSettings = { input: '', volume: 1, mode: 'toggle' };
const slot = saves.define({ key: 'voiceSettings', scope: 'device', version: 1,
  schema: v.object({ input: v.pipe(v.string(), v.maxLength(512)), volume: v.pipe(v.number(), v.minValue(0), v.maxValue(1)), mode: v.picklist(['toggle', 'hold']) }),
  initial: (): VoiceSettings => ({ ...DEFAULTS }) });
const listeners = new Set<(now: VoiceSettings) => void>();
let remembered: VoiceSettings = { ...DEFAULTS };

/** This device's voice settings; a page with no storage keeps them for the visit. */
export const voiceSettings = {
  read(): VoiceSettings { try { return slot.read(); } catch { return remembered; } },
  write(change: Partial<VoiceSettings>): void {
    const now = { ...voiceSettings.read(), ...change };
    remembered = now;
    try { slot.write(now); } catch { /* Kept for this visit only. */ }
    for (const listener of listeners) listener(now);
  },
  on(listener: (now: VoiceSettings) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

/** The keys bound to talk now, as binding codes (`KeyB`, `Shift`, `Mouse3`); `B` where no context binds it. */
export function voiceTalkKeys(): readonly string[] {
  try { for (const { action, codes } of app.input.bindings.entries()) if (action === VOICE_TALK && codes.length > 0) return codes; }
  catch { /* No input yet (a page still booting, a test): B. */ }
  return ['KeyB'];
}
/** The talk key as the player reads it: `B`. */
export const voiceTalkKey = (): string => keycap(voiceTalkKeys()[0] ?? 'KeyB');
/** Whether a keyboard is the main way in: the talk mode and the key only mean something there. */
const keyboard = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

function el(cls: string, tag = 'div'): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }
const label = (key: Parameters<typeof engineString>[0]): HTMLElement => { const e = el('ws-gmenu-swlabel', 'span'); e.textContent = engineString(key); return e; };

/** Settings ▸ Sound ▸ Voice's rows; `refresh` re-reads the microphones and the key on every open. */
export function voiceSettingsRows(scope: Scope): { rows: HTMLElement[]; refresh: () => void } {
  // ── Microphone: the browser's list; names show only once the mic was allowed, so until then they are numbered ──
  const inputRow = el('ws-gmenu-row'); inputRow.dataset['setting'] = 'voiceInput';
  const select = document.createElement('select'); select.className = 'ws-gmenu-select'; select.setAttribute('aria-label', engineString('s_voice_input'));
  inputRow.append(label('s_voice_input'), select);
  const listInputs = async (): Promise<void> => {
    let found: MediaDeviceInfo[] = [];
    try { found = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput' && device.deviceId !== 'default' && device.deviceId !== ''); } catch { /* No list: Default only. */ }
    const want = voiceSettings.read().input, options = [{ id: '', text: engineString('s_voice_input_default') },
      ...found.map((device, at) => ({ id: device.deviceId, text: device.label === '' ? engineString('s_voice_input_n', [at + 1]) : device.label }))];
    // A saved mic that isn't plugged in now stays picked, so plugging it back in needs no visit here.
    if (want !== '' && !options.some(option => option.id === want)) options.push({ id: want, text: engineString('s_voice_input_n', [options.length]) });
    select.replaceChildren(...options.map(({ id, text }) => { const option = document.createElement('option'); option.value = id; option.textContent = text; return option; }));
    select.value = want;
  };
  scope.listen(select, 'change', () => { voiceSettings.write({ input: select.value }); });
  scope.listen(select, 'pointerdown', event => { event.stopPropagation(); });
  if (typeof navigator.mediaDevices?.addEventListener === 'function') scope.listen(navigator.mediaDevices, 'devicechange', () => { void listInputs(); });

  // ── Voice volume: how loud everyone else is, 0 to 100 % ──
  const volumeRow = el('ws-gmenu-row'); volumeRow.dataset['setting'] = 'voiceVolume';
  const slider = document.createElement('input'); slider.type = 'range'; slider.className = 'ws-gmenu-slider'; slider.min = '0'; slider.max = '100'; slider.step = '5';
  slider.setAttribute('aria-label', engineString('s_voice_volume'));
  const readout = el('ws-gmenu-val', 'span');
  const paintVolume = (): void => { readout.textContent = engineString('s_voice_volume_pct', [slider.value]); };
  scope.listen(slider, 'input', () => { voiceSettings.write({ volume: Number(slider.value) / 100 }); paintVolume(); });
  scope.listen(slider, 'pointerdown', event => { event.stopPropagation(); });
  const volumeLabel = label('s_voice_volume'); volumeLabel.append(' ', readout);
  volumeRow.append(volumeLabel, slider);

  // ── Talk: press to toggle, or hold to talk (V11), and the key that does it ──
  const modeRow = el('ws-gmenu-row'); modeRow.dataset['setting'] = 'voiceMode';
  const seg = el('ws-gmenu-seg');
  const paintMode = (): void => { for (const button of seg.children) (button as HTMLElement).classList.toggle('active', (button as HTMLElement).dataset['v'] === voiceSettings.read().mode); };
  for (const [mode, text] of [['toggle', 's_voice_mode_toggle'], ['hold', 's_voice_mode_hold']] as const) {
    const button = el('ws-gmenu-segbtn', 'button') as HTMLButtonElement; button.type = 'button'; button.dataset['v'] = mode; button.textContent = engineString(text);
    listenTap(scope, button, () => { voiceSettings.write({ mode }); paintMode(); });
    seg.append(button);
  }
  modeRow.append(label('s_voice_mode'), seg);
  const note = el('ws-gmenu-note'); note.dataset['setting'] = 'voiceKey';

  const refresh = (): void => {
    const now = voiceSettings.read(), desk = keyboard();
    slider.value = String(Math.round(now.volume * 100)); paintVolume(); paintMode();
    modeRow.hidden = !desk;
    note.textContent = desk ? engineString('s_voice_key_note', [voiceTalkKey()]) : engineString('s_voice_phone_note');
    void listInputs();
  };
  refresh();
  return { rows: [inputRow, volumeRow, modeRow, note], refresh };
}
