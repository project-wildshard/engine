/** What an open arena's fight tells a page that steps no fight (J130): its look each tick it stands, each whirlwind that
 *  shows, and its grass fire. The tells say themselves (headlessArenaViews.ts). View words only: no fight reads one. */
import { sayFightView } from '@wildshard/engine/sim/shardRows';
import { OPEN_ARENA_VIEW } from '../../../shared/game/shardfile/wirePrompts';
import type { ArenaDraw, OpenArenaFight } from '../../../shared/game/boss/openArenaFight';

/** How often the field is said: as often as it steps. */
const FIELD_STEP = 0.1;

/** The tick's words for `fight`: run after its update. */
export function arenaWords(host: Parameters<typeof sayFightView>[0], fight: OpenArenaFight<ArenaDraw>): (dt: number) => void {
  const { whirls, field, fireOn } = fight.viewLoan, { width, depth, states } = field.rows, modes = field.modeCells;
  const said = new Uint8Array(field.length).fill(states.idle), shown = whirls.drawn.map(() => false);
  let stood = false, elapsed = 0, lit = false, clears = 0, next = 0;
  const fire = (): void => {
    const on = fireOn();
    if (!on && !lit) return;
    let any = false;
    for (let row = 0; row < depth; row++) {
      let moved = false, here = false;
      for (let cell = row * width; cell < (row + 1) * width; cell++) {
        const mode = modes[cell] ?? states.idle;
        if (mode !== states.idle) here = true;
        if (mode !== said[cell]) { moved = true; said[cell] = mode; }
      }
      any ||= here;
      // one row more each time, moved or not: a page that came late has the whole field within seconds
      if (moved || here && row === next) sayFightView(host, OPEN_ARENA_VIEW.cells, field.rowWord(row));
    }
    next = (next + 1) % depth;
    if (lit && !any) clears++;
    lit = any;
    sayFightView(host, OPEN_ARENA_VIEW.fire, [Number(on), clears]);
  };
  return dt => {
    const { visible } = fight.body;
    if (visible || stood) sayFightView(host, OPEN_ARENA_VIEW.look, fight.lookWord()); // the tick it goes, too
    stood = visible;
    whirls.drawn.forEach((row, index) => {
      if (row.shown === 1 || shown[index] === true) sayFightView(host, OPEN_ARENA_VIEW.whirl, [index, row.k, row.shown, row.x, row.y, row.z]);
      shown[index] = row.shown === 1;
    });
    if ((elapsed += dt) + 1e-9 < FIELD_STEP) return;
    elapsed = 0; fire();
  };
}
