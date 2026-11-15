import { app } from '../../src/client/engine/app/runtime';
import { ActorProjectionV2 } from '../../src/server/game/population/actorProjectionV2';
import { frozenRuntimeJson } from './frozen/snapshots';

/** Frozen author rows feed the real production binder and its scoped cache. */
export const projection = new ActorProjectionV2('balbal', frozenRuntimeJson('balbal-projection.json'), app);
export const BALBAL_SPECIES = projection.binding;
export function program(): ReturnType<ActorProjectionV2['program']> { return projection.program(); }
