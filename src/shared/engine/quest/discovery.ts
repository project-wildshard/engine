import {engineString} from '../strings';
import {practiceRoomState as practiceRoom} from '../core/practiceRoomState';
import type {Flags} from '../world/interact/flags';
import type {MapPoi} from '../../../client/engine/ui/Map';
import type {LiveMarker} from '../../../client/engine/quest/view';

/** a named place in world coordinates: discovered within `r`; `quiet` = discovered without a toast (the arrival point) */
export interface PlacePoint { id: string; label: string; x: number; z: number; r: number; quiet?: boolean; y?: number }

/** a level's named places: the map's points, discovery as the player walks, and the chip's markers */
export interface Places {
  /** the full map's list: places (named / "?") + the quest's markers */
  mapPois: () => MapPoi[];
  /** call a few times a second with the player's feet */
  update: (x: number, z: number, y?: number) => void;
  discovered: (id: string) => boolean;
  /** the places themselves, in world coords (E295: the last one reached is where a death puts you back, src/game/LastPlace.ts) */
  points: readonly PlacePoint[];
}

/** named places with saved discovery (`seen:<id>` flags) + the live quest markers, for the full map */
export function placesWithDiscovery(pts: PlacePoint[], flags: Flags, toast: (t: string) => void, markers: () => LiveMarker[]): Places {
  const out: MapPoi[] = [];
  return {
    points: pts,
    discovered: (id) => flags.has(`seen:${id}`),
    update: (x, z, y) => {
      if (practiceRoom.open) return; // an arena / playground has no discovery locations (E307)
      for (const p of pts) {
        if (flags.has(`seen:${p.id}`)) continue;
        const dy = p.y === undefined ? 0 : p.y - (y ?? Infinity);
        if ((p.x - x) ** 2 + (p.z - z) ** 2 + dy * dy < p.r * p.r) { flags.set(`seen:${p.id}`); if (p.quiet !== true) toast(engineString('s_4a4322f3623e', [p.label])); }
      }
    },
    mapPois: () => {
      out.length = 0;
      for (const p of pts) out.push({ x: p.x, z: p.z, label: p.label, kind: flags.has(`seen:${p.id}`) ? 'place' : 'unknown' });
      for (const m of markers()) out.push({ x: m.x, z: m.z, label: m.label, short: m.short, kind: 'quest' }); // the map labels a marker by its short name (E130)
      return out;
    },
  };
}
