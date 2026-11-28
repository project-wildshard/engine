# The pack wait reads the versioned cook

> Written by: Claude (opus-ship), 2026-11-27.

v0.1.101's staging go-live waited on `packs.wildshard.io/index/<build>/<hash>.json` for seven heads after the staging cook
moved to the versioned store, which never writes those. When the signed channel file (or staging's, for production)
names a cook for the build, FR-A17 and FR-A19 now read each head's cooked index at that cook, by its raw shard version.
