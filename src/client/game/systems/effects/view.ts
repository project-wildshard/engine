import type { ActiveEffect } from '@wildshard/engine/combat/effects/types';
import './status.css';

const PATHS: Readonly<Record<string, string>> = {
  'status-stun': 'M13 1 5 12h6l-2 11 10-14h-7z',
  'status-burn': 'M12 2c1 6-5 7-5 12 0 4 3 7 6 7s7-3 7-7c0-4-4-7-4-7s0 5-3 5c-3-1 1-6-1-10z',
  'status-poison': 'M7 3h10M9 3v6l-5 9v3h16v-3l-5-9V3M7 15h10',
  'status-bleed': 'M12 2 5 13c-5 10 19 10 14 0z',
  'status-slow': 'M12 3v18M4 7l16 10M4 17 20 7M8 2l4 3 4-3M8 22l4-3 4 3',
};

/** A row is mounted only while a status exists, leaving the resting HUD unchanged. */
export class StatusIcons {
  readonly root: HTMLDivElement = document.createElement('div');
  private key = '';
  constructor() { this.root.className = 'ws-status-effects'; this.root.setAttribute('aria-label', 'Status effects'); }
  update(active: readonly ActiveEffect[]): void {
    const statuses = active.filter((effect) => effect.def.icon !== undefined && effect.def.tags.some((tag) => tag.startsWith('status.')));
    const key = statuses.map((effect) => `${effect.def.id}:${effect.stacks}:${Math.ceil(effect.remaining)}`).join('|');
    if (key === this.key) return;
    this.key = key; this.root.replaceChildren();
    for (const effect of statuses) {
      const name = effect.def.id.slice('effect.'.length), item = document.createElement('span');
      item.className = 'ws-status-effect'; item.dataset['effect'] = effect.def.id;
      item.title = `${name} · ${effect.remaining.toFixed(1)} seconds`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', PATHS[effect.def.icon ?? ''] ?? ''); svg.append(path);
      const label = document.createElement('span');
      label.textContent = `${name.toUpperCase()}${effect.stacks > 1 ? ` ×${effect.stacks}` : ''} ${Math.ceil(effect.remaining)}s`;
      item.append(svg, label); this.root.append(item);
    }
  }
}
