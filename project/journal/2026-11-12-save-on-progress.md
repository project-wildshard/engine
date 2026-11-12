# Saves on progress, and no replayed "Quest complete" (TE-ENG8)

> Written by: Claude (opus-teeng8), 2026-11-12 ~03:50 Cancún

**Why.** opus-bm6 and opus-mh5b: a reload within 30 s of a kill lost it (Mossgate: a reload a second after the quest
lost everything, braziers too), and both "Quest complete" cards played again after a reload.

**What the page did.** Solo, the server runs in a worker and owns the world; the page asks it to save on a 30 s timer
(`clientWorker.ts` `SAVE_EVERY_MS`), on `visibilitychange` to hidden, on `pagehide` and before a navigation the game
chose. The 5 s autosave is a different thing: `liveSession.ts` checkpoints the page's own grid region and location, never
the server's world. A save is the worker's snapshot, posted to the page as `write` messages and put in IndexedDB
(`saves/indexed.ts`). On a reload the page asks, but the worker is gone before its answer comes back, so the leave
saves never landed. Online, the room already writes a seat 1 s after its quest book or ledger moves (`dedicatedRoom.ts`).

**What changed.** `server/host/standalone/progressWatch.ts`: after each tick the solo server looks at the host's flags
(world and lead player: quest steps, `dead:` kills), its public shared fields (every 2 ticks) and the ledger's filings;
when any moved it saves once the tick is done, at most every 250 ms, one at a time. An idle world writes nothing. On
Mossgate the page's IndexedDB holds the lit brazier 35 to 47 ms after the page shows it lit. A reload in the same instant
the page sees it still loses it: the save is in flight. No save format change: it is the same save, sooner.

`quest/finishedAfterSeen.ts`: the default "Quest complete" beat (`installQuestPresentation`) read the quest at install, but
on the wire the page's flags mirror the server's only from the world's first frame, so a finished quest read open, then
finished a frame later, and played its card. It now reads where the quest stood at the first settled frame
(`wirePage.settled`); a page off the wire reads its own flags at install as before.

Tests: `test/standalone-progress-save.test.ts` (a door field and a quest step reach storage within 1 s with no save
asked, and a fresh server boots with them; an idle world writes nothing; red before) and
`src/client/game/quest/finished-after-seen.test.ts` (red on the old rule).
