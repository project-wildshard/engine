# PAGE-SIZE PZ3: the client reads content from a content base

- opus-pz3, 20:40 Cancún. One boot-bank field, `contentBase` (an origin; empty means same origin). `src/client/engine/boot/contentBase.ts` owns `contentURL` / `pageURL`; every content reader (products, spawn download, packs book, entry read-ahead, card art, `versionedUrl`, texture packs, the solo server worker's base) goes through it. Member store keys stay page URLs (J138).
- Proof: `node scripts/content-base-proof.mjs` after `pnpm build:game`, two local origins: Driftwood and Pine boot solo, the page origin sees no shard content, the CDN no preflight and no CORS cookie. The title cards' CSS backgrounds stay no-cors reads (a stylesheet image can't be CORS); boot tables and `/assets/title/` `<img>` art stay on the page for PZ4 / D1.
- Seam: contentBase is an origin; PZ2's `shards/<sha256>/` and `engine/<hash>/` keys need a per-shard prefix map before PZ4 points it at R2.
