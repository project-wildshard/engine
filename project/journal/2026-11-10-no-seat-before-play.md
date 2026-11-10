# No seat before Play on an online build

Jake on play from his laptop (QA row 16, meta `docs/plans/QA-FEEDBACK-2026-11-10.md`): "before I pressed the buttons in the main
menu, somehow I already spawned in-game… when you go to the website, you shouldn't be logged in into the world, into the zone,
before you press play." His iPhone saw an avatar on the Driftwood pier while the laptop sat on a title.

Two causes. A level page's online shell joins during load and sends `ready` the moment `resume` lands, so the door seats a body
before the player has done anything. That is fine after a tap on the title, but a `?chunk=` load with no tap (a reopened tab, a
bookmark, a crash resume, any setting that boots the default level) opens the in-level title (`play.ts` `menuFirst`) over a seated
body. And no page ever sent the leave flag `socketPump.ts` reads, so every exit held the body for J114's 30 s.

Fix: on a build stamped with a world, `entry.ts` sends a load that would boot a level to the cold title unless a fresh title
arrival or grid intent brought it (`bootRoute.ts` `onlineTitleFirst`; `skipintro` and `tour` harnesses still enter). Crash resume is
the solo build's only. The online shell carries the tap across the reloads it makes itself (stale build, `elsewhere`). A navigation
the game chose (`holdLeaving`: menu exit, another world, the doctor) calls the new `leave()`, which sends the flag.

Codex review (J206) found three races, all fixed at the door (`world.ts`): a quit now counts from a socket's first byte, not only
once seated. A flag in the same read as `ready` used to be lost between the ready wait and `pumpSocket`, and seat the player; a flag
on the link that came back for a held body only renewed the hold. A quitter's held body is now handed to its cell as a seat whose
link has already left. The ready wait ignores a flagged `ready`. Client and server always run one build (the door refuses another),
so the client sends the flag on whatever link it has.

A second review found two more. A quit while the link was down (a redial's wait) went to a dead socket, and a connecting link only
queued it, so a navigation could cancel it: `leave()` now opens a fresh link when the old one is down, and resolves when the door
closes it; the page waits for that inside `holdLeaving`'s 4 s. And the tap carried across a self-reload went to the device-wide
backup too, so a bookmark in another tab could ride it in while the new-build panel retried: a self-reload now writes the tab's
session copy only, and drops it if the reload doesn't happen.

A third review: the page registered its leave only after boot, so a doctor or error-modal navigation mid-load skipped it. The shell's
leave is now held from the moment the shell exists.

Tests: `test/online-shell.test.ts` on the real door: seated leave drops the body at once (fails without the flag), a leave while
loading and a leave coalesced with `ready` take no seat (the door's seat order is spied on), a quit on a held body's returning link ends the hold,
and a quit while redialling lets the held body go (fails without the fresh link).
`test/navigation-arrival.test.ts` covers the route. `scripts/doctor-proof.mjs` deep-links with `skipintro=1`.
