import * as v from 'valibot';
import type { Database } from './database';
import { within } from './saveStore';

// MMO-PLAN MP2.4 (Q31): "Names: unique with a tag." The door claims a player's Name and tag here before it seats them, so no two
// players in the world read the same, and everyone sees `Name#1234`. A player keeps their tag while they keep their Name; a new
// Name draws a new tag. The unique index (`0004-names.sql`) is the rule, so two doors claiming at once can never both win.

/** Tags are four digits, as players read them. */
export const TAG_MIN = 1000, TAG_MAX = 9999;
/** Random draws before reading which tags are left. */
const DRAWS = 8;
/** A claim's wait: a join must not hang on a database that has stopped answering. */
const CLAIM_MS = 3000;
const HeldSchema = v.array(v.object({ name: v.string(), tag: v.nullable(v.number()) }));
const TagsSchema = v.array(v.object({ tag: v.number() }));
const READ_HELD = 'select name, tag from player where id = $1';
const CLAIM = 'insert into player (id, name, tag) values ($1, $2, $3) on conflict (id) do update set name = excluded.name, tag = excluded.tag, seen_at = now()';
const TAKEN = 'select tag from player where lower(name) = lower($1) and tag is not null';

/** What every other player reads. */
export const shownName = (name: string, tag: number): string => `${name}#${tag}`;
/** Every Name is spoken for at every tag: the world can't seat one more of it. */
export class NameFullError extends Error { override name = 'NameFullError'; }

/** A fair draw in [0, 1): tags are not a secret, but nobody should predict the next one either. */
const draw = (): number => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;
const taken = (error: unknown): boolean => error instanceof Error && /player_name_tag/u.test(error.message);

/** Claim `name` for `device` and answer what others read. `name` is already cleaned and filtered (`cleanName`). */
export function claimName(db: Database, device: string, name: string, random: () => number = draw): Promise<string> {
  return within(CLAIM_MS, async () => {
    const [held] = v.parse(HeldSchema, (await db.query(READ_HELD, [device])).rows);
    // Their own Name, or the same one in another case: the tag stays theirs.
    if (held !== undefined && held.tag !== null && held.name.toLowerCase() === name.toLowerCase()) {
      if (held.name !== name) await db.query(CLAIM, [device, name, held.tag]);
      return shownName(name, held.tag);
    }
    const tryTag = async (tag: number): Promise<boolean> => {
      try { await db.query(CLAIM, [device, name, tag]); return true; } catch (error) { if (taken(error)) return false; throw error; }
    };
    for (let tries = 0; tries < DRAWS; tries++) {
      const tag = TAG_MIN + Math.floor(random() * (TAG_MAX - TAG_MIN + 1));
      if (await tryTag(tag)) return shownName(name, tag);
    }
    // A crowded Name: read what's left, and take the free tags in a random order (another door may be taking them too).
    const used = new Set(v.parse(TagsSchema, (await db.query(TAKEN, [name])).rows).map(row => row.tag));
    const free: number[] = [];
    for (let tag = TAG_MIN; tag <= TAG_MAX; tag++) if (!used.has(tag)) free.push(tag);
    while (free.length > 0) {
      const [tag] = free.splice(Math.floor(random() * free.length), 1);
      if (tag !== undefined && await tryTag(tag)) return shownName(name, tag);
    }
    throw new NameFullError(`Every tag of ${name} is taken`);
  });
}
