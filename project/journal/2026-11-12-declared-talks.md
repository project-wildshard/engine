# 2026-11-12: a quest-giver from rows (TE-ENG3)

> Written by: Claude (opus-teeng3)

TE-ENG3 (meta `docs/plans/TEMPLATE-E2E-PLAN.md`) unblocks MH-5, Mossgate's Lamplighter: a data shard's page showed quest
chips and prompts only, and `questNpcs` needs `runtime.binds quests` or a `quest.page` client feature, which the author kit
can't write. A `targets.talks` row (shardfile format) now does it for any data shard. Opt-in and additive: a shard without
a talk row, and every native NPC, is unchanged.

- Rows: `targets.talks: [{ id, at, radius, label, dialogue, figure? }]`. `at` is the figure's feet; the prompt stands 1.5 m
  over them. `figure` names a props model or panel that draws it; none, and the page draws a stand-in (a body and a head).
  It is never a combat target.
- Server (`src/server/game/shardfile/declaredTalks.ts`): each player's node stays in `DeclaredQuests`, saved in the quest's
  existing dialogue part. The owner says it as an owned line (`dialogue:<tree>`: node index + 1, past the last once over)
  and takes `talk:<t>.<node>.<choice>` and `talk:<t>.end` as act claims (positions: short, wire-safe, apart from every
  interaction id), judged near the talk; an answer for a node the player has left, or a choice whose `when` is unmet, is
  refused. A choice sets its flags, so a `startWhen` quest starts; the quest pays coins
  and files its fact as before.
- Page (`src/client/game/shardfile/declaredTalks.ts`): E opens the box on the server's node with the choices whose
  conditions hold; an answer goes to the server and the next node opens once the server says it (a refused answer
  moves nothing), and an open box re-offers its choices when the flags they read change. A node with no choices ends the talk when read;
  one whose choices all wait on a flag just closes and stays. `DialogueBox` gains choices (and `offer`): E takes the
  first, a digit or a tap its own.

Tests: `test/declared-talk.test.ts` (rows-only fixture on Template: refused far off, the accept starts the quest, an early
report is refused, a save resumes at the node, the lamp and report finish it with 7 coins and the fact once, a second
player keeps its own node; red before) and `test/declared-talk-view.test.ts` (the page's half).

Format pin moves to shardfile `d6980ad` (`targets.talks`). Codex review: three MUSTs (wait for the server's node, not a
prediction on stale flags; wire-safe press ids; no clash with interaction ids), all applied. Preview: Mossgate with a
local Lamplighter row in headless Chromium: E opens the offer, the accept starts "Relight the Hollow", no console errors.
