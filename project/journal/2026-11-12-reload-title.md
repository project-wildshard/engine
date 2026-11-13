# A player's reload goes to the title (opus-reloadtitle)

Jake, 20:04 Cancún, iPhone 17 Pro Safari, prod v0.1.13: "when you press reload, like actually reloads the current thing you're
on. I expected reload to go back to main menu." His recording: a reload during Nalati's load started Nalati's load again.

- `lastEnd.ts` now tells the player's reload from the engine's. Every engine reload or navigation marks itself first
  (`markReload` / `markUnload`), and index.html's 12 s self-reload claims `boot.selfReload` just before it reloads. So a
  `reload` navigation with no marker and no crash, after a pagehide that ran visible moments ago (new session key
  `life.hid`), is the player's: `player` + `reload`. `entry.ts` sends it to the title before a still-pending tap or the
  grid's way in can enter the world again; `dropNotice.take` returns nothing, so there's no modal and no `title-drop` report.
- System reloads aren't the player's: a discarded tab, an iOS tab killed in the background (its pagehide ran hidden), a
  crash (alive beat). They keep the drop modal. A self-reload that retried a hung player reload (same address) still
  counts as the player's (review MUST 1); one that retried a hung deep link resumes.
- Surprise: boot chunk recovery reloaded with reason `reload`, which `bootRoute` sends to the title, so a stale chunk
  during a world's load landed on the title with the drop modal. It now reloads with `background` and resumes.
- Proof: `scripts/reload-title-proof.mjs` on a ring build, headless Chromium at 402×874: fresh `?chunk=` opens the shard,
  `page.reload()` lands on a quiet title, and a stale chunk failure during load reloads and resumes. Against the 18:43
  build (before this) it fails 6 checks: the reload resumed the shard and the recovery landed on the title.
- Known, not fixed: index.html's first-paint card can flash the shard's loading card for a moment before the title
  (another lane's file).
