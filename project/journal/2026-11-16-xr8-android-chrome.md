# 2026-11-16 TEST-COVERAGE row 46 XR-8: Android Chrome on the hosted emulator (mini-nb3)

- `phones.yml` android boot: 4 cores, error dialogs hidden, animations off, the launcher disabled (its ANR held input in
  run 43881038858), a 60 s settle, Chrome first-run flags before the first start, `am start -W`, a 3-minute wait for
  Chrome's process; API 36 as the last fallback. The boot step now fails when no attempt starts Chrome.
- Run 43967117784: Chrome 145 started (launcher off fixed the ANR); the proof then hit "No Chrome page": the
  `chrome_devtools_remote` socket refused for 90 s. Boot now turns developer options and USB debugging on, restarts
  Chrome and logs whether the socket opens.
