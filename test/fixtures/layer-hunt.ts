import { parse } from "valibot";
import type { CreatureSenses } from "@wildshard/format/creatureLayers";
import { parseRows } from "@wildshard/format/rows";
import { HuntTuningSchema } from "@wildshard/format/speciesPrograms";
import { groundFixture } from "./plain-ground";
import { FIXTURE_HUNT_TUNING } from "./hunt-tuning";

/** One actual native hunt on the data host, with no replacement brain ports. */
export function huntFixture(senses?: CreatureSenses) {
  const shard = groundFixture(),
    species = shard.rows.species[0],
    spawn = shard.creatures.spawns[0];
  if (species === undefined || spawn === undefined) throw new Error("Missing actual hunt source");
  species.temperament = {
    brain: "hunt",
    reaction: "aggressive",
    leash: 200,
    assist: 0,
    home: { speed: 2, stop: 0.5 },
    tuning: parse(HuntTuningSchema, { ...FIXTURE_HUNT_TUNING, hp: 117, noticeRate: 1 }),
  };
  if (senses !== undefined) species.senses = senses;
  shard.creatures.brains = [];
  spawn.brain = null;
  shard.spawn = { x: 0, y: 0, z: 0, yaw: 0 };
  shard.rows = parseRows(shard.rows);
  return shard;
}
