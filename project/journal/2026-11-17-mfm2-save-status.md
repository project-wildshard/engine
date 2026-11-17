# 2026-11-17 MMO failure modes, save status (opus-mfm2, plan/mfm2)

- FM8s modes 30, 30b, 31: the server already sent each player `save-confirmed` / `save-failed`
  (FM7b3) and nothing showed them. `online/saveScreens.ts` does now: a failure is Saving ·
  retrying at once, the card after 10 s of failing, and no confirmed save for 75 s (the room's
  60 s checkpoint, now `SAVE_CHECKPOINT_MS` in `persistenceWord.ts`, plus 15 s) is the late
  chip. No fact heard means an old server or memory store: nothing shows, ever.
- Leave the world is held through a cancelable `ws:leave-world` event that HUD.exitToMenu
  dispatches: online.js is its own bundle, so a module-level gate in lastEnd would be a second
  copy. Reloads are not held (R3/R4 keep their bounds).
