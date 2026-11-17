import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "valibot";
import { CreaturesSchema, type ShardCreatures } from "@wildshard/format/creatures";
import type { SpeciesBrain } from "../src/server/game/plugin/brain";
import {
  createShardfileSim,
  prepareShardfileSimRestore,
  type ShardfileSimPorts,
} from "../src/server/game/plugin/simulation";
import { loadRapier } from "../src/shared/engine/physics/rapier";
import { hashImmutableBytes } from "../src/shared/host/immutable";
import { snapshotSimHost } from "../src/shared/engine/sim/snapshot";
import { groundFixture } from "./fixtures/plain-ground";
import nativeRows from "./fixtures/plain-brain-roster.json";
import manifest from "./fixtures/wasm/plain-brain-roster.json";

// Exhaustive over defining types: adding a family or pattern requires an owner/proof here.
type OriginalName<B> = B extends { archetype: "grazer"; data: { pattern: infer P extends string } }
  ? `grazer/${P}`
  : B extends { archetype: infer A extends string }
    ? A
    : never;
const original = {
  "grazer/wander-ram": "ram-grazer",
  "grazer/circle-challenge": "challenge-grazer",
  diver: "diver",
  decision: "sim/scripts",
  "challenge-grazer": "challenge-grazer",
  "patrol-diver": "patrol-diver",
  script: "script",
  stalker: "stalker/skirmish",
  skirmisher: "skirmisher",
  guardian: "guardian",
  "perch-hunter": "perch-hunter",
} satisfies Record<OriginalName<SpeciesBrain>, string>;
type DeclaredName<B> = B extends { kind: infer K extends string; pattern: infer P extends string }
  ? `${K}/${P}`
  : B extends { kind: infer K extends string }
    ? K
    : never;
const owners = {
  pursue: "PlatformBrain",
  skirmisher: "SkirmisherBrain",
  guardian: "GuardianBrain",
  "perch-hunter": "PerchHunterBrain",
  "ram-grazer": "GrazerBrain",
  "challenge-grazer": "GrazerBrain",
  "orbit-diver": "DiverBrain",
  "patrol-diver": "DiverBrain",
  "burst-flyer": "DiverBrain",
  "grazer/wander-ram": "GrazerBrain",
  "grazer/circle-challenge": "GrazerBrain",
  "diver/orbit": "DiverBrain",
  "diver/patrol": "DiverBrain",
  "diver/burst": "DiverBrain",
  "guardian/interior": "GuardianBrain",
  "guardian/perch": "PerchHunterBrain",
  "stalker/skirmish": "SkirmisherBrain",
  script: "ScriptBrainDriver",
} satisfies Record<DeclaredName<ShardCreatures["brains"][number]>, string>;
const rapier = loadRapier(readFileSync("public/assets/physics/rapier.wasm"));
const wasm = new Uint8Array(readFileSync("test/fixtures/wasm/plain-brain-roster.wasm"));
const hash = hashImmutableBytes(wasm);
function fixture() {
  const source = groundFixture();
  source.spawn.z = 8;
  source.creatures = parse(CreaturesSchema, {
    ...source.creatures,
    brains: [
      {
        id: "fixture.brain",
        kind: "script",
        module: hash,
        thinkDivisor: 3,
        maxSpeed: 1,
        maxStrafe: 0,
        maxTurnRate: 6,
        parameters: [],
        strikes: [{ event: 9, strike: "fixture.bite" }],
      },
    ],
  });
  source.sim.scripts = [hash];
  return { source, assets: new Map([[hash, wasm]]) };
}
function ports(
  calls: string[],
  source: ReturnType<typeof groundFixture>,
): NonNullable<ShardfileSimPorts["scriptBrains"]> {
  return (host) => {
    host.registerStrikeCatalogue("fixture.actor", source.rows.strikes);
    return {
      ports: {
        observe: (actor) => {
          calls.push(actor.entityId);
          return [];
        },
        mayAttack: (actor) => host.events.ask("ai.mayAttack", actor),
        strike: (actor, strike) => {
          host.startDeclaredStrike(actor.entityId, host.nearestPlayer(actor.position).id, strike);
        },
      },
    };
  };
}

test("the defining eleven entries and complete declared names have explicit native or custom owners", () => {
  expect(Object.keys(original)).toHaveLength(11);
  expect(Object.keys(owners)).toHaveLength(18);
  for (const row of nativeRows) expect(owners).toHaveProperty(row.kind);
  expect(hash).toBe(manifest.sha256);
  expect(original.decision).toBe("sim/scripts"); // not a new creatures.brains callback or kind
});

test("a plain script upload cannot supply its own trusted observation, body or damage port", async () => {
  const f = fixture(),
    bytes = JSON.stringify(f.source);
  const R = await rapier;
  expect(() => createShardfileSim(f.source, f.assets, { rapier: R })).toThrow(
    "Missing custom brain port",
  );
  expect(JSON.stringify(f.source)).toBe(bytes);
});

test("the existing composed script owner advances one body and requests actual once-owned strikes", async () => {
  const f = fixture(),
    calls: string[] = [],
    resumedCalls: string[] = [];
  const sim = createShardfileSim(f.source, f.assets, {
    rapier: await rapier,
    scriptBrains: ports(calls, f.source),
  });
  const resumed = prepareShardfileSimRestore(f.source, f.assets, {
    rapier: await rapier,
    scriptBrains: ports(resumedCalls, f.source),
  });
  try {
    const actor = sim.host.entities.get("fixture.actor");
    if (actor === undefined) throw new Error("Missing script roster actor");
    const player = sim.host.nearestPlayer(actor.position),
      hits: number[] = [];
    sim.host.events.on(
      "damage.dealt",
      ({ req }) => {
        if (req.target !== player.health) return;
        expect(req.source).toBe(actor.combatActor());
        expect(req.moveId).toBe("fixture.bite");
        hits.push(req.amount);
      },
      sim.host.scope,
    );
    expect(sim.host.hasStep("script.declared")).toBe(true);
    expect(sim.host.hasStep("brain.fixture.actor")).toBe(false);
    expect(sim.host.entities.size).toBe(1);
    for (let tick = 0; tick < 30; tick++) sim.host.step();
    expect(calls).toEqual(Array.from({ length: 10 }, () => "fixture.actor"));
    expect(hits).toEqual([7]);
    expect(player.health.attributes.health).toBe(93);
    const saved = snapshotSimHost(sim.host);
    resumed.restore(saved);
    expect(resumedCalls).toEqual([]);
    expect(snapshotSimHost(resumed.host)).toEqual(saved);
    for (let tick = 0; tick < 90; tick++) {
      sim.host.step();
      resumed.host.step();
    }
    expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
  } finally {
    resumed.host.dispose();
    sim.dispose();
  }
});

test("an admitted script cannot bypass the actual attack permission owner", async () => {
  const f = fixture(),
    calls: string[] = [],
    sim = createShardfileSim(f.source, f.assets, {
      rapier: await rapier,
      scriptBrains: ports(calls, f.source),
    });
  try {
    const deny = sim.host.scope.child("roster.deny"),
      actor = sim.host.entities.get("fixture.actor");
    if (actor === undefined) throw new Error("Missing script actor");
    const player = sim.host.nearestPlayer(actor.position);
    sim.host.events.answer("ai.mayAttack", () => false, deny);
    for (let tick = 0; tick < 30; tick++) sim.host.step();
    expect(calls).toHaveLength(10);
    expect(player.health.attributes.health).toBe(100);
    deny.dispose();
    for (let tick = 0; tick < 30; tick++) sim.host.step();
    expect(player.health.attributes.health).toBe(93);
  } finally {
    sim.dispose();
  }
});
