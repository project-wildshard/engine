import { app } from '../../src/client/engine/app/runtime';
import { ActorProjectionV2 } from '../../src/server/game/population/actorProjectionV2';
import { liveBalbalProjection } from './liveNalati';

/** Nalati's live balbal projection feeds the real production binder and its scoped cache. */
export const projection = new ActorProjectionV2('balbal', liveBalbalProjection, app);
export const BALBAL_SPECIES = projection.binding;
export function program(): ReturnType<ActorProjectionV2['program']> { return projection.program(); }
