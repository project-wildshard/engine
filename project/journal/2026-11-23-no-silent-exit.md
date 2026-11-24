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

Boot 404 (the forced third failure): a world page whose main module 404s sat on its START card forever once index.html's one self-reload was spent, with the clock running and no word. The inline watchdog now hears the module's error event, and with the retry spent says "Couldn't start · Code BOOT-FAIL" with a Retry, storing a `boot-fail` screen report in the device outbox for the next page to send to Sentry.

The BOOT-FAIL card made the RL3 first-paint watchdog 62 lines against its cap of 29, and main went red (opus-sdkqa, 00:58 UTC). The card and its outbox report now sit in their own inline script (`data-boot-fail`, `globalThis.__wsBootFail`), and the watchdog calls it when its one retry is spent. Behaviour is unchanged.
