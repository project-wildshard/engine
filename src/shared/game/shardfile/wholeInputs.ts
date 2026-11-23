/** SHARD-COMPAT PR6: the rule is format's. This module stays only because a renderer input imports it (`client/game/plugin/geometry.ts`): its bytes are
 *  in the renderer revision, so moving its import would make every author preparation cook stale. It adds no rule. */
import { wholeGeometryInputs as formatWholeGeometryInputs } from '@wildshard/format/wholeInputs';

export const wholeGeometryInputs: typeof formatWholeGeometryInputs = formatWholeGeometryInputs;
