# The last script off the packs Worker (PACKS-CDN PC3 e)

buddy-repos' prod check found one engine file still naming the old
`wildshard-packs` Worker: `scripts/e7-voice-staging-proof.mjs` read
the staging channel from workers.dev. It reads
`packs.wildshard.io/releases/staging.json` now, as its sibling
e7-live-staging-proof.mjs already did. A tooling test greps the tree
for the Worker's host (journal excepted), so PC4 can delete the
Worker without a script quietly breaking.
