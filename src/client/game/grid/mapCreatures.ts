import type { MinimapAnimal } from '@wildshard/engine/ui/Minimap';

/** The creatures of a grid region in that region's own metres, and how far its frame sits from the home frame's (the minimap's). */
export interface RegionCreatures {
  readonly animals: readonly MinimapAnimal[];
  readonly dx: number;
  readonly dz: number;
}

/** What the map reads off a creature besides its kind and place. */
const READ = ['aggressive', 'rarity', 'alive', 'concealed', 'hp', 'maxHp', 'state', 'mem'] as const;
type Read = typeof READ[number];
function put<K extends Read>(to: MinimapAnimal, from: Pick<MinimapAnimal, K>, key: K): void {
  const value = from[key];
  if (value === undefined) delete to[key]; else to[key] = value;
}

/**
 * QA 2026-11-23-b row 7 (Jake, staging v0.1.74, iPhone 17 Pro: *"enemies dont show on the minimap anymore mini map broken"*).
 * On the grid the worker syncs every wire creature into the entered region's manager (`LiveGridSession.enteredAnimals`, or the
 * home's on the road), never the page's; the minimap read only the page's, so an online cell's boars were on the wire and
 * off the map. The map's creatures are the page's plus the region's, the region's moved into the home frame's metres
 * (play.ts `mapAt`). The returned list and its moved copies are reused paint to paint.
 */
export class MapCreatures {
  private readonly list: MinimapAnimal[] = [];
  private readonly moved: MinimapAnimal[] = [];

  of(page: readonly MinimapAnimal[], region: RegionCreatures | null): readonly MinimapAnimal[] {
    if (region === null || region.animals.length === 0 || region.animals === page) return page;
    const list = this.list; list.length = 0;
    for (const animal of page) list.push(animal);
    if (region.dx === 0 && region.dz === 0) { for (const animal of region.animals) list.push(animal); return list; }
    let n = 0;
    for (const animal of region.animals) {
      const copy = this.moved[n] ??= { kind: '', position: { x: 0, z: 0 } };
      n++;
      copy.kind = animal.kind;
      for (const key of READ) put(copy, animal, key);
      copy.position.x = animal.position.x + region.dx; copy.position.z = animal.position.z + region.dz;
      list.push(copy);
    }
    return list;
  }
}
