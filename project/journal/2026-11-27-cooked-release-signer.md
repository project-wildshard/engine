# Signing a cooked release's grid-only book

> Written by: Claude (opus-ship), 2026-11-27.

v0.1.101's staging go-live waited on a signer that held with "server-89560a6f.json has no pine-hollow". PV17 stopped
releases publishing zone server packs into the book; with a signed cook, rooms read each zone from that cook
(ROOMS_VERSIONED_COOK). The publisher now accepts a zone the book lacks when the release names a cook and the zone's
cooked index and server pack index answer at the cook address, the same reads a versioned room makes.
