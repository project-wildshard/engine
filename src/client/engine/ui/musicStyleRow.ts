import { listenTap } from '../input/dom';
import type { Scope } from '../../../shared/engine/app/scope';
import { onAudioBusy } from '../audio/preload';
import { engineString } from '../../../shared/engine/strings';
import { getMusicStyle, MUSIC_STYLES, onMusicStyle, setMusicStyle, type MusicStyle } from './Settings';

/** E5's player music preference belongs in Audio settings, independent of Developer or comparison flags. */
export function buildMusicStyleRow(scope: Scope): HTMLElement {
  const row = document.createElement('div'); row.className = 'ws-gmenu-row'; row.dataset['setting'] = 'musicStyle';
  const label = document.createElement('span'); label.className = 'ws-gmenu-label'; label.textContent = engineString('s_f89d28d8c13f');
  const box = document.createElement('div'); box.className = 'ws-gmenu-seg';
  const labels: Record<MusicStyle, string> = { piano: engineString('s_fa2bd181d8ba'), orchestral: engineString('s_573a2359591b'),
    folk: engineString('s_d3cafa5850d7'), synth: engineString('s_3cedb71562fd') };
  const buttons = MUSIC_STYLES.map(value => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ws-gmenu-segbtn';
    button.textContent = labels[value]; button.dataset['v'] = value;
    listenTap(scope, button, () => { setMusicStyle(value); }); box.append(button); return button;
  });
  const paint = (): void => { for (const button of buttons) button.classList.toggle('active', button.dataset['v'] === getMusicStyle()); };
  paint(); scope.onDispose(onMusicStyle(paint));
  scope.onDispose(onAudioBusy((kind, busy) => { if (kind === 'music') row.classList.toggle('busy', busy); }));
  row.append(label, box); return row;
}
