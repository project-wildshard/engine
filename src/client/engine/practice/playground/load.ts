/**
 * The playgrounds' loader (E307): each scene is its own lazy chunk, imported and built on the first tap of its card, and
 * kept for the rest of the page (a second visit is instant). main.ts calls it; the Explore hub only reads catalog.ts.
 */
import { registeredPlayground, type PlaygroundId } from './catalog';
import type { Playground, PlaygroundHost } from './Playground';

const built = new Map<PlaygroundId, Promise<Playground>>();

export function loadPlayground(id: PlaygroundId, host: PlaygroundHost): Promise<Playground> {
  let p = built.get(id);
  if (p === undefined) {
    const spec = registeredPlayground(id);
    p = spec !== undefined ? spec.load().then((Constructor) => {
      if (typeof Constructor !== 'function') throw new Error(`Playground ${id} did not load a constructor`);
      const Scene = Constructor as new (host: PlaygroundHost) => Playground;
      return new Scene(host);
    }) : Promise.reject(new Error(`Unknown playground: ${id}`));
    built.set(id, p);
    host.game.levelScope.onDispose(() => { built.delete(id); });
    p.catch(() => { built.delete(id); }); // a failed import can be tried again
  }
  return p;
}
