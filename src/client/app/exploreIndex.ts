import type { Scope } from '@wildshard/engine/app/scope';
import { mountDom } from '@wildshard/engine/input/dom';
import { installedCatalogue } from '@wildshard/engine/game/grid/catalogueSlot';
import { titleManifests } from '@wildshard/engine/game/shard/titleList';
import { exploreZones, readExploreOrder, type ExploreZone } from './exploreZones';
import './exploreIndex.css';

/** This page owns the zone links. Following one leaves its lightweight document behind. */
export function showExploreIndex(owner: Scope, notice?: string): void {
  const main = document.createElement('main');
  main.className = 'ws-explore-index';
  main.dataset['scroll'] = '';
  const heading = document.createElement('h1');
  heading.textContent = 'Explore Wildshard';
  const list = document.createElement('ul');
  const empty = document.createElement('p');
  empty.textContent = 'No zones are available in this build.';
  const paint = (zones: readonly ExploreZone[]): void => {
    const focused = list.contains(document.activeElement) ? document.activeElement?.getAttribute('href') : null;
    list.replaceChildren(...zones.map(zone => {
      const row = document.createElement('li'), link = document.createElement('a');
      link.href = `/${encodeURIComponent(zone.slug)}`;
      if (zone.image) {
        const image = document.createElement('img');
        image.src = zone.image; image.alt = ''; image.loading = 'lazy'; link.append(image);
      }
      const title = document.createElement('span');
      title.textContent = zone.name;
      link.append(title); row.append(link);
      return row;
    }));
    empty.hidden = zones.length > 0;
    if (focused !== null) [...list.querySelectorAll('a')].find(link => link.getAttribute('href') === focused)?.focus({ preventScroll: true });
  };
  main.append(heading);
  if (notice !== undefined) {
    const message = document.createElement('p');
    message.textContent = notice;
    message.setAttribute('role', 'status');
    main.append(message);
  }
  main.append(list, empty);
  mountDom(owner, document.body, main);
  document.title = 'Explore Wildshard';
  document.querySelector('[data-title-shell]')?.remove();
  paint(exploreZones(installedCatalogue(), titleManifests()));
  document.dispatchEvent(new Event('ws:control-ready'));
  void readExploreOrder().then(served => {
    if (served !== null && !owner.disposed) paint(exploreZones(installedCatalogue(), titleManifests(), served));
    return undefined;
  });
}
