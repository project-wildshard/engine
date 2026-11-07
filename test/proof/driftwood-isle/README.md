# Driftwood native gameplay witness

Use Node's real SDK loader and type transform, without browser globals:

```
node --experimental-transform-types --import ./scripts/sim-node-loader.mjs test/proof/driftwood-isle/run.mjs checkpoints
node --experimental-transform-types --import ./scripts/sim-node-loader.mjs test/proof/driftwood-isle/run.mjs record
node --experimental-transform-types --import ./scripts/sim-node-loader.mjs test/proof/driftwood-isle/run.mjs fresh
node --experimental-transform-types --import ./scripts/sim-node-loader.mjs test/proof/driftwood-isle/run.mjs reef
node --experimental-transform-types --import ./scripts/sim-node-loader.mjs test/proof/driftwood-isle/run.mjs zipline
```

`checkpoints` authors a bounded continuous player-command tape through the checked
`data/headlessAssembly.json` capability map and the native assembly: Wendell,
the flint chest, the lookout and beacon, the hold sailor/key/pump/winch/strongbox, iron sword, the nearby plate crabs, the physical
barrel on plate B and player on plate A, the sluice and cave shard, the altar, the living Captain and the reward.
No code writes player poses, HP, flags, grants or actor decisions. If the player dies or the tape stalls, it fails.
At the living Captain it also restores a fork and compares the **uninterrupted original** against that fork through
victory/reward: full canonical state and committed effects, exactly. Every captured profile prefix came from those
completed ticks' actual effects. The second quest fact at reward is recorded honestly; the ledger grants only once.

CI runs `headless` (10k ticks plus the real 92/92 entry proof), `slice-tick-10000`, `slice-captain`, `replay`
(the actual mid-fight checkpoint, exact suffix, and 60 SDK-worker ticks), and `ledger-spawn` / `ledger-tick-10000` /
`ledger-captain`. Each slice executes at most 10k ticks. The worker wrapper installs the same platform-stable test math
before importing the same production runtime; it replaces no gameplay. Canonical hashes compare native world state,
including exact poses/velocities/contacts, rather than Rapier's noncanonical serialization order.

`fresh` hashes every loaded repository module, the runner/loader/lockfile and physics module. It checks the input tape
and each compressed checkpoint SHA too. A changed input refuses the old checkpoints; regenerate from real play.
Snapshots also carry their actual profile prefixes, so reload/refusal/retry/dedupe proves earned achievements rather
than synthetic facts. `record` writes `compatibility.json` from executing these proofs. `all` is deliberately nonzero:
the scoped gameplay proofs pass, but **whole-shard compatibility remains false** while `open` lists the page laws and
optional gameplay not covered here. This is not a claim of browser parity for every contact/rig/camera/optional quest.

SF34 installs the actual lowered sea, including its four dry sockets, before fresh play and before restore. Its Gerstner
bob reads the host's own restored clock. The wet Sealed Ring tape now takes 19,816 ticks (previously 19,255): wading
changes travel and fight positions, so the key approach follows the sailor's actual fall. The real Captain checkpoint
is tick 18,898 at 190 HP; victory/reward follows in 918 ticks. The changed gameplay also defeats three nearby plate crabs
instead of two. These are recorded outcomes of the shipping water law, not grants or adjusted combat tuning.

The independent reef proof starts at the real spawn, swims east around the island and crosses the jetty's dry asphalt
approach, then dives to the actual optional chest. It earns eight doubloons in the pack and one durable treasure fact.
It restores the earned mid-dive checkpoint in the native host and SDK worker. The 60-worker-tick window includes held
DIVE, the real treasure command and held SURFACE; the native original/restored pair continues through the complete
137-tick suffix to surface. Complete canonical physics agrees at worker boundaries and at the final native state;
player/swim state and effects agree every native tick. The reef route itself consumes no cached Sealed Ring checkpoints.
Whole-shard compatibility remains false for the other laws in `open`.

Living creature head/body/fore volumes now use the actual baked rig rest chains and the shipping scalar/custom
pose laws. The browser baker checks each chain against the loaded skeleton inverse binds. Contacts read the previous
published pose, while body updates advance current locals; snapshots preserve both. The source-hashed native oracle
covers each living rig for 10k frames and a restored suffix, including 60 / 30 / 20 Hz and paused scheduling.
Rendered ragdoll bodies remain outside the witness.

The sailor rise/sink/deck transition has one pure defining function, called by the page animation and the trusted body
callback. Visual rig work stays on the page. Actual Driftwood and Pine browser captures retain every earlier gameplay
field; Driftwood adds 35 captured pose recipes. Before the SF34 swim extension above, the tape stayed at 19,255 ticks, with the living Captain at
18,339 (190 HP), the same fact ticks and the same 916-tick fight/reward suffix. Its new checkpoint payloads include the
pose continuations. Exact original/restored state, 60 SDK-worker ticks and durable/refused-write ledger proofs pass.
Jake picked flared pier ramps (plan ca6e4631e); they are the only path. The straight variant and Debug row are removed.

Chest items now use the shipping pack law and authored Driftwood catalogue, with copied, strictly bounded pack
continuations. The real tape earns two doubloons from Wendell's chest and three from the strongbox: five pack items,
separate from purse coins (the 10k prefix still has two; the strongbox opens at tick 11,101). A focused native prompt test opens the actual reef chest, earns its eight doubloons and
treasure fact, then restores exactly and refuses a duplicate opening. That test places the player at the prompt and
does not claim underwater travel by itself; the independent reef journey above now covers that approach. Reward
carry/camera is hosted below; the real zipline approach and landing are now covered by the independent journey below.

The finale now executes the same immutable AssemblyScript director in the page and trusted worker. Its complete
author continuation replaces the quest adapter's native `reward` timer in the three checkpoints. All other canonical
fields (physics, actors, strikes, RNG, clock, flags, pack and native keepers), the 19,816-tick command tape, fact ticks
and profile prefixes remain exact. The real Captain replay still starts at tick 18,898 with 190 HP and reaches victory
and reward in 918 ticks; the restored worker agrees for 60 ticks. The page's previous finale is retained only as a
test oracle, with 10k event/pose decisions and a silent restored author suffix. Whole-shard compatibility remains false
for the laws listed in `open`; moving the timer to a script does not close those gaps.

The existing native reward pose keeper now consumes the admitted director events in the real post-player phase.
Its sole player owner carries the player to the authored position/yaw/pitch, eases the golden-hour clock, clears
impulse and preserves the completion handoff. Mid-beat and finished-state restore are exact and silent.
The completion card's world freeze/resume and its menu choices remain unhosted; whole-shard compatibility stays false.

Hosting the actual reward carry changes the recorded tape from 19,816 to 19,843 ticks (+27): the player
now finishes its approach under the shipping eased carry, rather than continuing ordinary walking. The living
Captain checkpoint remains tick 18,898 at 190 HP, the quest fact stays tick 19,681, and the exact replay suffix
is 945 ticks. These are real gameplay outcomes with unchanged authored tuning.

The grid-return admission fix widens only the declared director player-x/player-z inputs from +/-250 to +/-10000,
because runtime construction observes the player before crossing the cell edge (the failed return was x=-256.631).
The complete director declaration is part of its continuation: all three checkpoint hashes and the final digest
therefore change deliberately. An exact decoded comparison proves each checkpoint differs only in those four
contract min/max values; physics, player/actor state, RNG, script author memory, flags, pack and ledger profiles match.
The compressed command tape is byte-identical at 19,843 ticks, Captain remains tick 18,898 at 190 HP, and every
fact/effect tick and the 945-tick replay suffix remain unchanged. The official cache recorder authors the new small
manifest and compatibility receipt; retained source gzip files stay untouched. Scoped proofs pass; whole-shard
compatibility remains false for the existing open list.

The two native hosts now select prompts with the shipping client picker: actual page registration order, live reach and positions, weak fallback and native line of sight from the player eye. Captured collider owners retain the distinction between a registered piece and an explicit string owner. Hidden or used Driftwood rows stop competing, and the dropped hold key follows its actual fall. Explicit prompt acts answer only the selected prompt; walk-in pickups, plates, the barrel and lash-owned cracks retain their separate laws. A nearer unhosted prompt still competes. Native wall/restore assertions pass in both Driftwood and Signal. The Sealed Ring command tape and every checkpoint field except the newly retained collider sight tags are exact; the changed checkpoint hashes are deliberate. Whole-shard Driftwood compatibility stays false for its remaining open list.

The independent zipline journey walks from the actual spawn through Wendell, the lookout and beacon to the
launch deck, using bounded stick/jump inputs and the actual nearest/LOS prompt. It approaches the deck from its
authored stair side, rather than teleporting or granting flags. Launch is tick 7,120; its native feet are
(115.991, 34.080, 58.261). At tick 7,218 it restores the real mid-ride continuation and compares the uninterrupted
original through the complete 182-tick landing suffix. The SDK worker independently agrees for 60 committed ticks,
including canonical state and emitted effects. Landing earns exactly one zipline fact, preserved by a durable
ledger reload; no fact exists before landing. `zipline` is an executable regression and `record` includes its outcome.

This closes only the walk to the zipline launch and its carry/landing. The Sealed Ring tape and its three existing checkpoint payloads/outcomes remain unchanged.
Its recorder now also retains the earned lookout continuation in the generation cache, with only its small hash row
committed. The regression resumes that real prefix, then executes every remaining approach/ride tick; it repeats no
walking prefix and keeps the existing 90-second deadline. Whole-shard compatibility stays false: rendered ragdoll contacts, camera crosshair /
hitstop / clang, completion-card freeze/resume and menu choices, every sea-glass route, and the remaining bounded
ecology / ship laws are still open. No production runtime, collider, view or platform source changes in this slice.


DS1.5 Node-canonical physics runs the real world, creature constructors and Adventure registration without a renderer. It records construction-epoch AI goals rather than the first rendered-frame retarget. The first boar goal differs by at most 4.351295768597197 m; habitat floors differ by at most 1.199040866595169e-14 m. Settled static collider rows are byte-identical. All 34 actors, 11 herds, 34 pieces and 2,067 solids retain their native recipes. The shared host reads the installed terrain datum and admits species in the actual kit window. Independent Node regeneration compares bytes; CI needs no browser.

Fresh page equality oracle, actual spots and map recapture pass. The map image remains byte-identical. Official collision walk: **8 legs, 0 stuck, no page errors**. Official whole native recorder, Captain restore/worker, reef, zipline and durable Ledger contracts pass; compatibility stays false for the existing honest open list. The command tape and all checkpoint payloads remain byte-identical; input-only manifests remain the pusher’s responsibility.


SF81 DIR-3 deliberately re-records all four cached witnesses: spawn.snap.gz, tick-10000.snap.gz, lookout.snap.gz and captain.snap.gz. The new version-3 finale continuation contains the authored stage contract/cursor and the original complete AssemblyScript snapshot. Exact decoded comparison after unwrapping that AS snapshot proves every other native field identical. Old unversioned finale continuations are explicitly refused; restore of v3 is atomic and silent. Command gzip bytes, 19,843 ticks, effects, profile prefixes, Captain at 18,898/190 HP, the 945-tick replay, SDK worker, reef, zipline and durable/refused-write Ledger outcomes are exact. Native hashes change only because the continuation now includes the row cursor. Whole-shard compatibility remains false for every existing open requirement. Cinematic camera, native body, reward carry and golden-hour presentation remain in the shard.


DS1.5 Node quest placement executes the real native world, adventure, authored sword-drop factory and shop constructor. The real planet constructor supplies the reward direction. All 30 table rows, talk and guarded-sword points, reward pose, zipline, and 16 ordered prompts including the unknown shop competitor match independent real page reads exactly. No tick or renderer creates these rows. All physics gameplay fields, map pixels and canonical Captain restore/60-tick worker outcomes remain exact. Cold Node check and forced cache regeneration compare byte-identically. Compatibility remains false for the unchanged open list.
