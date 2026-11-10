# One tap reloads, at once, every time

Jake, on his phone in production: "i press it i get no feedback",
"i sometimes see confirm reload", "I need the full page loading modal".
His screen recording showed the cause. The reload button is the build
pill beside the WILDSHARD logo: 122 by 19 CSS px of 8 px text.

On the title a tap called the worker's adopt. Adopt waited for the new
worker to download the whole new build's code before it reloaded, with
nothing on screen and no time limit. On 4G that is seconds to minutes,
and the busy flag swallowed every later tap. On the loading card the
first tap only armed G877's "Confirm reload" text inside the same pill.
That was the game's own string, not the browser's leave dialog: no
beforeunload handler here cancels a navigation.

Now the tap's own turn turns the pill into a disabled loading button
and puts a full-page RELOADING cover over everything (reloadCover.ts).
Only the page unloading takes it down. One tap reloads everywhere;
G877's confirm step is gone. Adopt takes a `within` of 3 s from the
tap. After 2 s of precache an online page skips waiting anyway. At 3 s
the page reloads hard, and the cover says so in amber. The pill keeps
its look; an invisible frame takes its hit area to 45 px tall. Every
other reload a player asks for shows the same cover: Settings' Apply
and Reload, the error modal, the load failure screen, Debug's clear
downloads, and the online new-build panel.

Tests: the tap is read synchronously after the click; a waiting worker
that never answers PRECACHE still reloads at 3 s; online it skips
waiting at 2 s; and no client code can raise the browser's leave
prompt.

iOS Simulator check (Jake: "It has to be checked in the iOS simulator").
The pill and Settings take real taps in Mobile Safari and as a Home
Screen web app; the page starts under the status bar (no
viewport-fit=cover), so nothing near the top eats them. The load
failure screen's RELOAD showed no cover: the screen sits at the top
z-index, above the cover, and its handler navigated in the same turn,
which stops WebKit painting at once. The cover now takes the top
z-index, and every reload leaves one painted frame after showing it
(at most 100 ms).

Settings ▸ Build (R9, opus-reload3). The title's and the pause menu's
Settings get one compact row beside the Connection doctor: the running
build, CHECK (reads /version.json) and RELOAD. RELOAD is the pill's own
reload, moved to ui/playerReload.ts so both share it; CHECK announces
what it read (ws-live-build), so the pill lights from it too and a
controlling worker hears of the build. Both buttons are 44 px tall.
The review's two should-fixes: sw.ts adopt now leaves through
leaveAfterPaint (its own module, boot/leaveAfterPaint.ts, so the
worker boot doesn't pull the cover in), and the stale-build reload
waits for the cover, loading its module if nobody answered the ask
(an unbundled dev page could reach it first). iOS Simulator: in Device
Hub a click lands ~26 pt above where the screen draws it (measured
with a touch probe page); taps 3 pt inside RELOAD's top edge hit, in
Safari and as a Home Screen web app.
J206 Codex review of e1f55e4: no MUST-FIX. Its should-fixes are done:
the pill's and Check's /version.json reads share one order
(checkLiveBuild), so a slow earlier read never takes back a newer
build; and a worker drop that fails still waits for the cover.
