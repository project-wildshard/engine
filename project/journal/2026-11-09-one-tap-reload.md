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
