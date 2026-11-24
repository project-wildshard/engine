import { expect, test } from "vitest";
import { Scope } from "@wildshard/engine/app/scope";
import { ShardfileClient } from "../src/client/game/shardfile/client";
import { installChapterWakeEncounter } from "../src/client/game/quest/chapterDirector";
import { publishBoundQuest } from "../src/shared/game/quest/boundState";
import type { ShardContext } from "../src/client/game/plugin/context";
import { huntFixture } from "./fixtures/layer-hunt";
import { emptyShardfile } from "../src/shared/host/author";
import { FIXTURE_RUNTIME_COST } from "./fixtures/clientPlanRuntime";

// K6b (v0.1.56 preparation client): Driftwood 18a9e2c (content e271cc9) never entered in "Prepare in phone WebKit". Its
// creatures are declared rows now (OF27d: the client plan drops `population.product-creatures`), so its runtime page's data
// client runs full, and two play-stage gaps threw at `level.play` (a fatal shard-load the card holds on, no page error):
// the data client required its own items though the runtime binds `items` (its held claims build the equipment), and the
// page's chapter wake bound the Captain as a runtime boss, though OF22c2 made him a declared spawn with a `boss` encounter.

function roster(binds: readonly string[]) {
  const hunt = huntFixture(), source = emptyShardfile({ slug: "roster", name: "Roster", author: "Test", seed: 1, revision: 1 });
  source.rows = { ...source.rows, species: hunt.rows.species, strikes: hunt.rows.strikes };
  source.creatures = hunt.creatures;
  source.runtime = { kind: "client-plan", cost: FIXTURE_RUNTIME_COST, binds, spawns: { homes: [], bosses: [], actors: [] } } as never;
  source.rows.looks = source.rows.species.map((row) => ({ id: `fixture.look.${row.kind}`, species: row.id, recipe: "platform.rig", material: null,
    parameters: { library: "absent" }, animation: { recipe: "platform.rig", parameters: {} } }));
  return source;
}
function runtimePage(binds: readonly string[]): ShardfileClient {
  return new ShardfileClient(roster(binds), { releaseTransport: () => undefined } as never, {
    instance: "roster", recipes: new Map(), items: new Map(), catalogue: [], voices: () => new Map(),
    icon: () => { throw new Error("No fixture items"); }, nativeRuntime: true, audioOwner: "runtime", worldOwner: "runtime" } as never);
}
/** The play stage's first step, with every normal play service standing and no items installed by this page. */
function firstPlayStep(page: ShardfileClient): IteratorResult<void, void> {
  Reflect.set(page, "worldTiles", { props: null });
  const ctx = { game: { runtime: { world: {}, play: {} } }, app: { player: {} } } as unknown as ShardContext;
  const steps = Reflect.get(page, "playSteps") as (this: ShardfileClient, ...args: unknown[]) => Generator<void, void>;
  return Reflect.apply(steps, page, [ctx, null, null, null]).next();
}

test("a runtime page whose runtime binds items plays its declared roster with no items of its own", () => {
  const page = runtimePage(["items", "spawns"]);
  expect(Reflect.get(page, "mode")).toBe("full");
  expect(firstPlayStep(page).done).toBe(false);
});

test("a runtime page that leaves items to its data still needs them installed before play", () => {
  expect(() => firstPlayStep(runtimePage(["spawns"]))).toThrow("Shardfile requires the normal play stage");
});

// Driftwood's shipped wake row (quests/wake-boss.json, shard-driftwood e271cc9)
const WAKE = { version: 1, quest: "sealed-ring", spawn: "driftwood.captain", director: "quests/chapter-director.json",
  cues: [{ effects: [], id: "captain.restore", operation: "restore" }, { combat: 1, effects: [{ kind: "toast", text: "The pool boils" }], id: "captain.wake", operation: "wake" },
    { effects: [{ kind: "sting", name: "chunk" }], id: "captain.dead", operation: "effects" }],
  encounter: { arena: { radius: 22 }, deadFlag: "dead:captain", events: { restore: "captain.restore", wake: "captain.wake" },
    fields: { arena: "arena", awake: "awake", phase: "phase", poolX: "poolX", poolZ: "poolZ", rise: "rise" }, id: "boss.captain", kind: "captain",
    level: "driftwood-isle", name: "The Drowned Captain", phases: [{ at: 1 }, { at: 0.66 }, { at: 0.33 }], presentation: { cuts: [0.66, 0.33], riseAbove: 0.5 },
    step: "driftwood.captain", wakeFlag: "used:altar" },
  systems: { before: ["main.world"], director: "shard.driftwood.director", encounter: "shard.driftwood-isle.installFinale" } };

function wakeContext(encounters: readonly object[]): ShardContext {
  const shardfile = { ...roster(["spawns"]), encounters }, scope = new Scope("entered");
  publishBoundQuest(scope, { def: { id: "sealed-ring" }, flags: {} } as never);
  // the director read comes after the boss binding: reaching it means the page bound what it needed
  return { scope, product: { shardfile, file: () => Promise.reject(new Error("K6b director read")) } } as unknown as ShardContext;
}

test("a chapter wake naming a declared boss spawn binds no runtime boss on the page", async () => {
  const fight = { id: "boss.captain", entity: "driftwood.captain", kind: "boss" };
  await expect(installChapterWakeEncounter(wakeContext([fight]), WAKE, { x: 0, z: 0 })).rejects.toThrow("K6b director read");
});

// SHARD-COMPAT CP16, FORMAT-PRUNE FP21 s8: kept originals Driftwood r4 and r5 wake the island's reserved Captain, which the page binds
test("a chapter wake naming no declared fight still needs its runtime boss row", async () => {
  await expect(installChapterWakeEncounter(wakeContext([]), WAKE, { x: 0, z: 0 })).rejects.toThrow("Undeclared runtime boss driftwood.captain");
});
