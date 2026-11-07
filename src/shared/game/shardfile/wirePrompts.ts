/** What a page's traversal prompts name on the wire: a server has no prompt row for these, so both sides spell the id from a row they each hold. */
export const carryPrompt = (mover: string, end: number): string => `${mover}.ride.${String(end)}`;
/** The view call a boss's strike goes by, with its id behind it: a page's telegraph has no body of its own to read one off. */
export const BOSS_STRIKE = 'boss.strike.';
/** What a roaming boss's fight tells its views, by name: a page on a server steps no fight. */
export const ROAMING_VIEW = { light: 'roaming.light', roar: 'roaming.roar', burst: 'roaming.burst', hazard: 'roaming.hazard', add: 'roaming.add', ring: 'roaming.ring', tell: 'roaming.tell', tellOff: 'roaming.tell.off', lane: 'roaming.lane', room: 'roaming.room', rig: 'roaming.rig', struck: 'roaming.struck' } as const;
/** What an open arena's fight tells its views, by name: a page on a server steps no fight, so it draws what these say. */
export const OPEN_ARENA_VIEW = { look: 'open-arena.look', tell: 'open-arena.tell', whirl: 'open-arena.whirl', fire: 'open-arena.fire', cells: 'open-arena.cells' } as const;
/** A tell's calls, as `OPEN_ARENA_VIEW.tell` numbers them. */
export const ARENA_TELL_CALLS = ['ring', 'lane', 'wedge', 'hide'] as const;
/** A tell's slot on the wire: its id's place in the arena's tell rows, and which of that id. */
export const arenaTellSlot = (id: number, index: number): number => id * 16 + index;
/** A hazard's beats, as `ROAMING_VIEW.hazard` numbers them. */
export const ROAMING_HAZARD_EVENTS = ['drop', 'fall', 'land', 'burn', 'out', 'placed'] as const;
/** The view calls an elite's ground tells go by. */
/** The word a server's spawn script says its cues under: a cue's id, then where it landed. */
export const spawnCueWord = (script: string): string => `spawn.cue:${script}`;
export const ELITE_TELL = { lane: 'elite.tell.lane', ring: 'elite.tell.ring', cue: 'elite.cue', hit: 'elite.hit' } as const;
/** The arrow a patrol's rider looses: where it leaves, then its velocity. */
export const PATROL_SHOT = 'patrol.shot';
/** Each step a rider is dying: where it tears. */
export const PATROL_TEAR = 'patrol.tear';
/** One slot of a thrown volley, as a script row. */
export const volleyRow = (owner: string, slot: number): string => `volley.${owner}.${String(slot)}`;
/** A socket lift's deck, by the call it takes. */
export const liftPrompt = (mover: string, action: 1 | 2 | 3): string => `${mover}.lift.${String(action)}`;
