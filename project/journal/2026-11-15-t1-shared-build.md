# Template suite shared build

T1E-2a reuses Ring 1's installed pins and catalogue locally. The existing
CI products unit publishes its client, Template pin and released saves
as one artifact for the four suite consumers. No second client build is
needed. Ring 1 lives in ci.yml since J244.

Local proof: `WS_LANE_NAME=codex-te2e pnpm test:t1 boot.spec.ts` builds the
Ring-1 client and passes actual title-to-Template control in 22.3 seconds.
`actionlint .github/workflows/ci.yml` passes. Hosted evidence remains owed
until the final plan land; this commit alone does not qualify it.
