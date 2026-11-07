/** A quest page's barred door (G565): a living building's door borrowed by its page, barred until its flags open it. */
import * as v from 'valibot';
import { QuestPageDoorSchema } from '@wildshard/format/questPageFacets';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { ShardContext } from '../plugin/context';
import { forestPage } from '../shardfile/forestPage';
import { QuestFlagGates } from '../../../shared/game/quest/flagGates';
import { wirePage } from '../shardfile/wirePage';

/**
 * Borrow the forest page's declared door (its prompt and use, for the door page's owners) and bar it with the page's flag
 * gates on the door's registered piece. A build without that door (its building not drawn on this tier) has no door: null.
 */
export function installPageDoor(ctx: ShardContext, input: unknown): { readonly prompt: Interactable; readonly use: () => void } | null {
  const rows = v.parse(QuestPageDoorSchema, input), { life, lateDoors } = forestPage(ctx.scope, rows.forest).cabins;
  const pieces = life.doorPieces(), index = pieces.findIndex(piece => piece.id === rows.door);
  const piece = pieces[index], prompt = life.interactables[index];
  const view = wirePage.gates; // J106: on the wire a gate is this player's, off its `phase` events
  // I2: a late cabin weld hydrates and registers its doors after control, so the door may not stand yet; the gate binds its registered piece then
  const bar = (): void => { if (!ctx.scope.disposed && !ctx.scope.disposing && life.doorPieces().some(door => door.id === rows.door)) new QuestFlagGates(ctx, rows.gates, false, view); };
  if (rows.gates.gates.some(gate => gate.target.kind !== 'piece' || gate.target.piece !== rows.door)) throw new Error('Page door gates bar its own registered piece');
  if (lateDoors === null) bar(); else void lateDoors.then(bar);
  if (piece === undefined || prompt === undefined) return null;
  return { prompt, use: piece.use };
}
