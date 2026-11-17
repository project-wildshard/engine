import { parse } from "valibot";
import { CreaturesSchema } from "@wildshard/format/creatures";
import { parseRows } from "@wildshard/format/rows";
import { groundFixture } from "./plain-ground";
import { perchFixture } from "./plain-perch";
import nativeRows from "./plain-brain-roster.json";

export const canonical = [...nativeRows, perchFixture().creatures.brains[0]];
export const aliases = [
  ["skirmisher", "stalker", "skirmish"],
  ["guardian", "guardian", "interior"],
  ["perch-hunter", "guardian", "perch"],
  ["ram-grazer", "grazer", "wander-ram"],
  ["challenge-grazer", "grazer", "circle-challenge"],
  ["orbit-diver", "diver", "orbit"],
  ["patrol-diver", "diver", "patrol"],
  ["burst-flyer", "diver", "burst"],
] as const;
export function fixture(input: unknown) {
  const brain = parse(CreaturesSchema, { brains: [input], groups: [], spawns: [] }).brains[0];
  if (brain === undefined) throw new Error("Missing roster declaration");
  const kind = brain.kind,
    pattern = "pattern" in brain ? brain.pattern : undefined;
  const perch = kind === "perch-hunter" || (kind === "guardian" && pattern === "perch");
  const base = perch ? perchFixture() : groundFixture(),
    spawn = base.creatures.spawns[0],
    species = base.rows.species[0];
  if (spawn === undefined || species === undefined) throw new Error("Missing roster actor");
  if (kind === "ram-grazer" || (kind === "grazer" && pattern === "wander-ram"))
    spawn.home = { x: 0, y: 0, z: 7, r: 45 };
  if (kind === "challenge-grazer" || (kind === "grazer" && pattern === "circle-challenge"))
    spawn.phaseOffset = 0.3;
  if (
    kind === "diver" ||
    kind === "orbit-diver" ||
    kind === "patrol-diver" ||
    kind === "burst-flyer"
  ) {
    species.flight = { altitude: 4, above: "world", climbRate: 12, diveRate: 12 };
    spawn.at = [0, 4, 7];
  }
  const bite = base.rows.strikes[0];
  if (bite === undefined) throw new Error("Missing roster contact");
  base.rows.strikes.push({
    ...bite,
    id: "fixture.charge",
    shape: { kind: "lane", length: 4, width: 2 },
  });
  if (kind === "ram-grazer" || (kind === "grazer" && pattern === "wander-ram"))
    bite.shape = { kind: "lane", length: 4, width: 2 };
  if (kind === "challenge-grazer" || (kind === "grazer" && pattern === "circle-challenge"))
    bite.shape = { kind: "arc", radius: 2, halfAngle: Math.PI / 2 };
  return {
    ...base,
    spawn: { x: 0, y: 0, z: 8, yaw: Math.PI },
    rows: parseRows(base.rows),
    creatures: parse(CreaturesSchema, { ...base.creatures, brains: [brain], spawns: [spawn] }),
  };
}
export function requireBrain(kind: string) {
  const row = canonical.find((value) => value?.kind === kind);
  if (row === undefined) throw new Error(`Missing canonical roster ${kind}`);
  return row;
}
