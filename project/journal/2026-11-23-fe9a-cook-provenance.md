# FE9a (wip): the cook records chain provenance

> Written by: Claude (opus-compat-w5), 2026-11-23

`cookProvenance.ts` gives the original's format, the chain id and the
migrated copy's digest; `runCookJob` refuses by slug when the API's digest
under the same chain differs. Unfinished: typecheck and a test are next.
