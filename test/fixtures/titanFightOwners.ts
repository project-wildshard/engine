import room from '../../src/shards/nalati-grasslands/data/bossArenaRoom.json' with { type: 'json' };
import view from '../../src/shards/nalati-grasslands/data/kurganView.json' with { type: 'json' };
import king from './nalati-goldenKing-original.json' with { type: 'json' };

/** The unchanged full room/King envelope retained in the shipping fight file.
 * Numeric arena tests borrow these fields without constructing another owner. */
export const titanFightOwners: { readonly arenaRoom: typeof room & { readonly view: typeof view }; readonly king: typeof king } = {
  arenaRoom: { ...room, view }, king,
};
