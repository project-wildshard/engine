# A zone entered from its own cook (meta standalone shardfiles SF5)

- `src/scripts/zone-cook-entry.mjs --slug <zone> --tarball <shardfile>`
  is the local proof the re-pack rows (SF5 to SF9) close on: it builds a
  preview page that bakes Dunes only (Brasscap Mesa when Dunes is the
  zone under proof), cooks the tarball with ring-cook
  (one cook per tarball hash), attaches the cook from a local pack
  origin, and enters the zone alone on a headless desktop (1280x800)
  and phone (402x874, pixel density 3), muted.
- It records every request and lists the zone art the page origin
  answered: a file under the engine's `public/` that the tarball names,
  whose path names the zone, or that SF1's `public-engine.json` leaves
  out. Title art is the page's own. It exits 1 when gameplay is not
  reached or that list is not empty.
- `--reuse <run>` keeps the page build and every cook; attaching always
  starts from a pristine copy of the page, since attaching writes the
  pack origin into it.
- First run, Pine Hollow slice 1 (shard-pine-hollow@4ea81b2, 383 MB,
  cook 749 s at load 55): desktop reaches gameplay in 17 s from the cook
  but reads its far view (`/assets/baked/pine-hollow/far*`) from the
  page; the phone stops on a ground layer KTX2 it asks the page for
  (`/assets/gpu/tex/rock_ground/arm.phone-…`), though the tarball
  carries it. Both are the mount reads SF4's client half moves.
- The page reads the cook from a second loopback origin, so each context
  gets Chromium's `local-network-access` grant, as boot-smoke's alone
  case does; `skipintro=1` boots the one cell past the title.
- `ring-cook.mjs --pins=<file>` reads another pin table, so the cook can
  run over a tarball that is not pinned yet.
