# SA15: an installed `wildshard dev` walks (2026-11-13, opus-sa15)

> Written by: Claude

- `wildshard dev` serves engine's devserver client with the author's shard inline (`ws-shardfile`). On this engine the
  page never got there: the browser path refuses a non-first-party product ("Client product needs its build-owned
  reader"), and the page started the default catalogue shard's (Driftwood's) spawn download, whose parts then failed
  the load. A DEVSERVER build now reads and installs its inline shard as its own product and starts no spawn download.
- sharddev can't build the client (it is this repo's whole app build), so `scripts/devserver-client.mjs` packs it
  (2.3 GB built, 115 MB packed once first-party shard content is dropped) and server-release.yml uploads it as
  `devserver-client.tar.gz` to each release it publishes. sharddev fetches it at its engine pin (SD-2).
- Proof: sharddev packed and installed outside every checkout, `wildshard new isle`, `wildshard dev isle/src`, the
  client fetched from a local stand-in release; headless Chromium at `?skipintro` holds W and walks 8.5 m in 2.5 s.
- Release half (ENG-16): the devserver-client job runs after publish on every server-release, uploads once, and skips a source from before the script.
