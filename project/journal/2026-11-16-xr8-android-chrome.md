# 2026-11-16 TEST-COVERAGE row 46 XR-8: Android Chrome on the hosted emulator (mini-nb3)

- `phones.yml` android boot: 4 cores, error dialogs hidden, animations off, the launcher disabled (its ANR held input in
  run 43881038858), a 60 s settle, Chrome first-run flags before the first start, `am start -W`, a 3-minute wait for
  Chrome's process; API 36 as the last fallback. The boot step now fails when no attempt starts Chrome.
