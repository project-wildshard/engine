/**
 * A grid resident's maps in the home frame (playtest round 3). The page's minimap and full map draw in the home cell's
 * metres (the grid's overlays, `mapAt` in play.ts), while a resident shard registers its points of interest, zone names and
 * marks in its own cell's metres, as it does standalone. These facades move what a resident registers by its cell's offset
 * from the home, so Pine Hollow's THE RIDGE lands in Pine Hollow's cell and not in the home's. Everything else passes through.
 *
 *   const fullMap = shiftedFullMap(page.fullMap, cell.origin.x - home.x, cell.origin.z - home.z);
 */
import type { FullMap, MapPoi, MapZone } from '@wildshard/engine/ui/Map';
import type { MapMark } from '@wildshard/engine/ui/Minimap';
import type { Scope } from '@wildshard/engine/app/scope';

type Method = (...args: unknown[]) => unknown;
/** `service` with `overrides` in place of its own methods; every other member reads through, its methods bound to `service` */
function overlay<T extends object>(service: T, overrides: Partial<T>): T {
  if (typeof service !== 'object') return service; // a host double without the service (the play host's maps are optional to tests)
  const bound = new Map<PropertyKey, Method>();
  return new Proxy(service, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      const known = bound.get(key); if (known !== undefined) return known;
      const method = value as Method, call: Method = (...args) => Reflect.apply(method, target, args);
      bound.set(key, call);
      return call;
    },
    set(target, key, value: unknown) { return Reflect.set(target, key, value, target); },
  });
}

const shift = <P extends { x: number; z: number }>(dx: number, dz: number) => (p: P): P => ({ ...p, x: p.x + dx, z: p.z + dz });

/** The full map for a resident whose cell sits (dx, dz) metres from the home's: its pins and zone names move by that much. */
export function shiftedFullMap(map: FullMap, dx: number, dz: number): FullMap {
  if (dx === 0 && dz === 0) return map;
  const poi = shift<MapPoi>(dx, dz), zone = shift<MapZone>(dx, dz);
  const setPois: FullMap['setPois'] = (source, opts) => { map.setPois(() => source().map(poi), opts); };
  const addPois: FullMap['addPois'] = (source) => map.addPois(() => source().map(poi));
  const setZones: FullMap['setZones'] = (zones) => { map.setZones(zones.map(zone)); };
  return overlay(map, { setPois, addPois, setZones });
}

/**
 * G580 T1: the page's full map for one of several live residents. Its single slots (places, quest card, zone names) are
 * the entered resident's: what a resident sets is held and applied when it is entered (`enter`: its entered-service
 * installer), and cleared when it leaves, so a warm neighbour never replaces the entered cell's map. Layers (`addPois`,
 * `addQuest`) and everything else pass through.
 */
export function enteredFullMap(map: FullMap, enter: (install: (scope: Scope) => void) => void): FullMap {
  let pois: Parameters<FullMap['setPois']> | null = null, quest: Parameters<FullMap['setQuest']>[0] | null = null, zones: readonly MapZone[] | null = null;
  let entered = false;
  enter((scope) => {
    entered = true;
    if (pois !== null) map.setPois(...pois);
    if (quest !== null) map.setQuest(quest);
    if (zones !== null) map.setZones(zones);
    scope.onDispose(() => {
      entered = false;
      if (pois !== null) map.setPois(() => []);
      if (quest !== null) map.setQuest(() => null);
      if (zones !== null) map.setZones([]);
    });
  });
  return overlay(map, {
    setPois: (...args) => { pois = args; if (entered) map.setPois(...args); },
    setQuest: (source) => { quest = source; if (entered) map.setQuest(source); },
    setZones: (value) => { zones = value; if (entered) map.setZones(value); },
  });
}

/** what a resident's play host reaches of the minimap (ShardPlayHost.minimap) */
export interface MarkSink { setMarks: (source: (() => readonly MapMark[]) | null) => void; addMarks: (source: () => readonly MapMark[]) => () => void }
/** The minimap for a resident whose cell sits (dx, dz) metres from the home's: its marks move by that much. */
export function shiftedMinimap(minimap: MarkSink, dx: number, dz: number): MarkSink {
  if (dx === 0 && dz === 0) return minimap;
  const mark = shift<MapMark>(dx, dz);
  const setMarks: MarkSink['setMarks'] = (source) => { minimap.setMarks(source === null ? null : () => source().map(mark)); };
  const addMarks: MarkSink['addMarks'] = (source) => minimap.addMarks(() => source().map(mark));
  return overlay(minimap, { setMarks, addMarks });
}
