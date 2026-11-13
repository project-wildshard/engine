# SA43: `wildshard prepare` without an engine checkout (2026-11-13, opus-sa43)

> Written by: Claude

- `wildshard prepare` records a draft in phone WebKit against a production-renderer page that carries it. That page
  was an engine worktree's `WILDSHARD_PREPARATION_ONLY` preview (UP5), so an author with only the installed SDK could
  not prepare, and the API refuses a draft.
- A `WILDSHARD_PREPARATION_ONLY` build now also sets a `__PREPARATION_ONLY__` define. Such a page owns an inline
  `ws-shardfile` the way a DEVSERVER page does: it reads and installs it as its own product and starts no catalogue
  spawn download (at `?chunk=` too). A released build has the define false; check-devserver refuses either define
  left unsubstituted, and still refuses a preparation-only build.
- `scripts/devserver-client.mjs --kind preparation` packs that build, pruned as the devserver client is
  (`preparation-client.tar.gz`, 311 MB packed), and server-release.yml's devserver-client job uploads it beside the
  devserver client on every release it publishes. sharddev fetches it at its engine pin.
- Proof: the packed client, served by sharddev's new preview around a `new` project's draft, prepared it in headless
  phone WebKit in 4 s (35 programs, fence 177, as UP5's 35 and 178); the API's commit check admits the result
  (sdk 0.3). Chromium walks the same page 8.5 m.
