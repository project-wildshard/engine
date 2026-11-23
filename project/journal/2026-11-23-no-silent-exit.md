# No silent exit (J501)

Jake got dropped from Signal Dunes to the main menu with no word. The cause: the rooms-revision reload was a bare
`location.reload()`, which the next page read as the player's own reload, so the title stayed quiet on purpose
(opus-finish's 584c80cc4 now marks it). The real hole was the class: any navigation that says nothing looks like the
player. So there is one funnel now (`endPlay`, `reloadPlay`, `showEnd`, each with a short code), the drop modal shows
the code to everyone with Retry where it can work, Sentry gets `exit_code`/`zone`/`revision`/`room`/`step`, and
`test/no-silent-exit.test.ts` refuses any new navigation or title-showing catch that doesn't say why first.

Row 23 rides beside it: a neighbour's bad spawn file (Brasscap's discovery.json) used to fail Driftwood's whole boot.
Now it is skipped and reported as NEIGHBOUR-FILE; the zone's own bad file still refuses.

Row 23 landed as its own commit: the neighbour test is `test/spawn-download.test.ts`'s last case (Brasscap's 9-byte discovery.json against its listed 5).
