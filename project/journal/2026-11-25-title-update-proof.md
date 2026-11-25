# The title on an update, measured on staging (opus-rel86, meta QA 11-24 row 7)

- qa-play's tmp/opus-qa-play/local-update.mjs went with its worktree, so scripts/title-update-proof.mjs rebuilds it and
  stays committed: `seed` makes a cold or warm Chromium profile on the build staging serves (headless, muted, keychain
  flags, the agent marker in the UA, never `?agent=`); `open` reopens it after the next alias move and logs each
  document's title time and longest frame gap through the idle hand-over. Pass: title within 2 s, no frame over 1 s.
- The title URL is `?mute=1` only: `skipintro=1` goes straight into play, so a seed with it never sees `.ws-main`.
