# The production door fails closed

> Written by: Claude (opus-lamp138), 2026-11-26

5d7778a66 let a self-signed replica admit its bots by refusing agents only when the release key equals the pinned one. That
check failed open: a production box whose `RELEASE_PUBLIC_KEY` read as `''`, blank or garbled would admit agents. Now only a
well-formed Ed25519 SPKI key that is not the pinned one counts as a replica; anything else on production refuses. The server
decides the mode once and logs it at boot (`door.agents`: `refusing agents` or `replica, admitting agents`), so a wrong mode
shows in the journal.
