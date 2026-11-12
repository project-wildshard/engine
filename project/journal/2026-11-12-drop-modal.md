# Drop modal (opus-dropmodal)

Jake, 17:22 Cancún, iPhone, staging v0.1.13 `b3e9a56`: Blender Template loaded to LOAD step 19/20 (Worker boot) and snapped
straight to the title with no word. "Where's the fucking error modal? … maybe it's like unexpectedly back at the main menu
modal … we gotta do fucking something."

- Every title the player did not ask for now opens a modal: plain words for everyone, the real error with Developer on
  (message, code or close reason, stack, the step), COPY DETAILS and DISMISS. `src/client/engine/boot/dropNotice.ts` holds the
  breadcrumb (session save, plus a device copy a killed iOS process can't lose, ignored after 10 min); `src/client/app/dropModal.ts`
  draws it; `entry.ts` shows it once on the title and sends it to Sentry (`system: title-drop`).
- Two ways a drop gets its words: code that leaves by itself calls `recordDrop` first (guardBoot's recovery reload, the grid
  recovery fallback, the grid re-entry fallback in `pageEntry.ts`); anything else with a breadcrumb (a crash, a silent
  `location.replace('/')`, a system reload) becomes "The game restarted unexpectedly" / "Unexpectedly back at the title" with
  the last step and the last error the page saw.
- The player's own exits stay quiet: `exitSessionToTitle` clears the breadcrumb; the loading card's EXIT TO TITLE, the error
  modal's buttons, update, new game and the rest are matched by their `markUnload` words (`PLAYER_EXITS`), because
  `Loading.ts` was another lane's dirty file.
- Surprise: in a home-screen app `session.ts` strips `?chunk=` from the URL during load, so any iOS kill reloads to the bare
  title. That is why a crash there looks like "snaps to the main menu".

## Review fixes (claude -p, 6 MUSTs folded)

- A page the player left normally (lastEnd `fresh`: Back, a typed `/`) shows nothing; every game-made path to `/` says
  why first (`markUnload` / `recordDrop`).
- Device copies are every tab's: read only when lastEnd says the page died, and only for that page's world. No more
  10-minute window and no pagehide clearing (an iOS app switch fires pagehide on a live page).
- A crash that boots straight back into its world (crash resume, grid recovery) shows the modal over the loading card.
- Every player reload or exit calls `leftByPlayer()` (Loading retry and exit, ReloadPrompt, ErrorModal, playerReload);
  `PLAYER_EXITS` stays as the backstop.
- Sentry gets errors and real crashes, not the game's own reloads; a repeating error writes the breadcrumb once.

## Jake's sharpened rule (17:52 Cancún)

"Anything going to the main menu in an uninspected fashion is considered an error … Normal navigation ending on the title
screen is not normal navigation." The guard is now an invariant at the title, not one handler per failure path:

- A title reached from a world page in this tab needs the player's token (`leftByPlayer()` writes `drop.expect`); without
  it the title opens the modal and reports to Sentry, even with no error anywhere. This reverses review MUST 1: a browser
  back or an unmarked `location.replace('/')` from a world is now a drop on purpose.
- Quiet titles: the token, the first boot of a visit, a title after a title.
- The breadcrumb keeps a redirect trail (`arrivedBy`, lastEnd's reason, from `entry.ts`), so Brasscap's server `resume` to
  Driftwood and the shell's "elsewhere" show as "Blender Template at Worker boot → online seat elsewhere (driftwood-isle)".
- `lastEnd.markUnload` notes every game navigation's words and call-site stack (`noteDropRoute`); developer details and
  Sentry carry both.
