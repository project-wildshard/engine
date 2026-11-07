/** Every state a creature can be in. Shared: the server steps them and the wire's `animal` table names them. */
export const ANIMAL_STATES = ['idle', 'graze', 'wander', 'alert', 'flee', 'charge', 'stalk', 'dead', 'attack', 'perch', 'rise', 'hide', 'sidestep'] as const;
