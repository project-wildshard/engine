# The devserver client keeps its card art (TC13, buddy-engine)

- Mini QA TC13 (`Queued: macbook-ship`): a fresh SDK project on engine
  0.1.29 404ed on every catalogue card image (Driftwood, Pine, Nalati,
  Nine, Dunes, Template, Far Reach, Thin Ice). `pruneDevserverClient`
  kept each `shardfiles/<slug>/discovery.json` but deleted the rest of
  the slug's folder, including `blobs/image/*`, the files its `art` map
  (URL to bytes, the page's `artBytes`) names.
- `discoveryArt(client)` reads every kept discovery file's `art` before
  the prune. Every drop step keeps those files and removes the rest, and
  a folder emptied by the prune goes too.
- After the prune, a named art file the client lacks refuses the archive
  and names the file. A 404 now fails the release, not every author's
  page. An art URL outside the client is refused.
- Proof: a real devserver and preparation build from the pins (27
  discovery files, 138 art files, 3.5 MB). Both archives hold all 138
  and no other shard files. Tests: both kinds keep the named art and
  drop the rest; a missing file refuses. All three new tests are red on
  the old script.
