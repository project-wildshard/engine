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
