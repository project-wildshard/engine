# The cook's engine music line reads the build's tables

> Written by: Claude (opus-repacks), 2026-11-26, meta standalone-shardfiles SF4; fixes main red CI 45924093166 tests (8).

SF4 (239e3aa3d) made `musicDir` read the music folder from the asset tables, so a zone style keeps its own folder. The
cook's `engineMusicLine` (`entryTotals.ts`) called it bare in the Node cook, where no tables are installed, and every
manifest cook threw "No asset tables installed" (`test/download-audio-list.test.ts`, and a real cook alike). It now reads
inside `withAssetTables(tables, …)`, as `shardBootAudio` does, and so does the test's own folder check.

Guard: `test/download-audio-list.test.ts` cooks the pinned products through that line, 7 of 7 green.
