# Zone sweep gate (opus-zonesweep1)

Jake asked whether every Zone select card opens. The release gate only ever opened Driftwood and Pine, so a zone
anywhere else in the list could break unseen. `scripts/zone-sweep.mjs` opens every card the page shows, one fresh phone
context each; verify-staging.sh runs it and production go-live refuses a missing or failed Chromium sweep on the build.
First sweep, staging v0.1.36: 11 of 11 open (Chromium).
