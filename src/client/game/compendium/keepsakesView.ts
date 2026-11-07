import type { Object3D } from 'three';
import { app } from '@wildshard/engine/app/runtime';
import { ownSceneTree, sceneObjectOwner } from '@wildshard/engine/app/sceneOwnership';
import { InteractSfx } from '@wildshard/engine/audio/interactSfx';
import { modelContext, type ModelContext, type ModelDef } from '@wildshard/engine/models/model';
import { place } from '@wildshard/engine/models/place';
import { CollectionDisplay, collectionCosmetic, type CollectionCatalogue } from '../models/collectionDisplay';
import type { CollectionKeepsakeHost } from './keepsakes';

type ViewHost = Pick<CollectionKeepsakeHost<never>, 'rows' | 'models' | 'loose' | 'owner' | 'place' | 'sky' | 'hud' | 'audio' | 'music' | 'swords' | 'body' | 'registry'>;

type WornSlot = CollectionKeepsakeHost<never>['rows']['wardrobe'][number]['slot'];

/** What the keepsakes' law asks of the page: the displays, the worn pieces, and how an award looks and sounds. */
export interface KeepsakeView {
  readonly chime: CollectionDisplay | null;
  readonly plaques: CollectionDisplay | null;
  readonly random: () => number;
  readonly loose: (model: string, trophy: string | undefined) => Object3D;
  readonly dress: (trophies: readonly (readonly [string, boolean])[], worn: readonly { readonly slot: WornSlot; readonly model: string; readonly on: boolean }[]) => void;
  readonly announce: (text: string, gain: number) => void;
  readonly glow: (amount: number) => void;
}

/** The page half of the keepsakes (P1-E4.10): build the placed displays and draw what the law decides. */
export function keepsakeView(h: ViewHost): KeepsakeView {
  const { rows } = h, ctx = modelContext(h.sky), scope = h.owner?.scope;
  const sfx = new InteractSfx(h.audio), floor = h.place(rows.floor).y;
  const displays = new Map<string, CollectionDisplay>();
  for (const row of rows.placements) {
    const model = h.models[row.model];
    if (model === undefined) throw new Error(`Missing collection model: ${row.model}`);
    const at = h.place({ poi: row.poi, x: row.x, z: row.z, y: floor + row.up, yaw: row.yaw });
    const build = (): Object3D => place(model, [{ ...at, scale: row.scale, params: row.params }], {
      ctx, draw: 'single', ...(h.registry === undefined ? {} : { registry: h.registry }), piece: row.piece,
    }).object;
    const object = scope === undefined ? build() : scope.run(build);
    if (scope !== undefined) {
      const mine = sceneObjectOwner(object);
      if (mine === null || mine === (object.parent === null ? null : sceneObjectOwner(object.parent))) ownSceneTree(object, scope, app.assets);
    }
    if (object instanceof CollectionDisplay) displays.set(row.role, object);
  }
  const chime = displays.get('count') ?? null, plaques = displays.get('trophies') ?? null;
  const wardrobe = new Map<string, Object3D>();
  return { chime, plaques, random: () => app.rng.stream('loot').next(), loose: (model, trophy) => h.loose(model, trophy, ctx),
    dress: (trophies, worn) => {
      for (const [id, filled] of trophies) plaques?.setFilled(id, filled);
      for (const row of worn) {
        if (h.body === null) continue;
        if (!row.on) { h.body.wardrobe.wear(row.slot, null); continue; }
        let object = wardrobe.get(row.model);
        if (object === undefined) { object = h.loose(row.model, undefined, ctx); wardrobe.set(row.model, object); }
        h.body.wardrobe.wear(row.slot, object);
      }
    },
    announce: (text, gain) => { h.hud.toast(text); sfx.interact('chime', undefined, { gain }); h.music.sting('pickup'); },
    glow: amount => { for (const sword of h.swords) sword.bladeGlow = amount; },
  };
}

/** The catalogue's trophy or a cosmetic's model, as the keepsakes' `loose` port makes them. */
export function collectionLoose<P extends object>(owner: { readonly catalogue: CollectionCatalogue; readonly models: ReadonlyMap<string, ModelDef<P>> }):
(key: string, trophy: string | undefined, ctx: ModelContext) => Object3D {
  return (key, trophy, ctx) => {
    if (trophy !== undefined) return owner.catalogue.trophy(key, trophy, ctx);
    const model = owner.models.get(key); if (model === undefined) throw new Error(`Missing collection cosmetic: ${key}`);
    return collectionCosmetic(model, ctx);
  };
}
