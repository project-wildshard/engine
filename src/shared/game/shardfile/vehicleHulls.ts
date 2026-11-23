/** SHARD-COMPAT PR6: the rule is format's. This module stays only because a renderer input imports it (`client/game/plugin/ui.ts`): its bytes are
 *  in the renderer revision, so moving its import would make every author preparation cook stale. It adds no rule. */
import { vehicleHulls as formatVehicleHulls } from '@wildshard/format/vehicleHulls';

export const vehicleHulls: typeof formatVehicleHulls = formatVehicleHulls;
