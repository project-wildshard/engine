// SHARD-SOURCE SS-MS2a3b: a data cell's ride prompts inside the grid. A one-shard page joins its movers' ride prompts to the
// page's (`dataPageMovers.ts`); a grid copy built its movers (`dataCellMovers.ts`) but did not, so on staging (v0.1.42) Mirror
// Salt's land-sail offered no board prompt in its cell. The ride prompts join the copy's own at admission, in its frame (the
// page offers them only while the feet stand in it). The steer ride itself is an entry of the one install list
// (`shardfile/playInstalls.ts`, SS-GP7), installed per stay by `dataCellPlay.ts`.
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { DataCellMovers } from './dataCellMovers';

/** A copy's carry prompts (board and leave, a steer vehicle's riding with it), for the copy's prompts. */
export const cellRidePrompts = (movers: DataCellMovers | null): Interactable[] => movers?.movers.ridePrompts() ?? [];
