Meta QA 11-28 row 2 (PLAY-IN-30S TP2): Jake's phone took 81 s to reach Pine Hollow, and 34.5 s of it was Home region
and Spawn detail waiting on `Read Model data`. On staging, which uses the production cooked path, a cold Pine boot fetched
desktop part `7f9f5ded40b52d6f.pack.br` (2.87 MB, 95 GLBs) 33 times in 3.5 s of Spawn detail: 121 MB of repeat fetches
out of 263 MB, against a 114.5 MB phone manifest.

The cause is in the spawn download's fetch layer. A read that the download no longer holds, and that the zone's cooked
`members` table lists, fetched the member's whole part with `native(member.part)`, once per read, with nothing shared.
The table names the first part that holds the bytes, often a desktop part. Now:

- such a read tries this tier's own part first (`partMember`: shared by `partReads`, members kept in the store);
- else it shares one read of the index's part, and the last parts read are kept (16 MiB, `boot/cooked-part-cache`);
- a reader's abort ends only its own wait;
- a retry (`cache: 'reload'`) still reaches the origin alone.

`partMember` also reads a member the store already keeps before it fetches the part again.
`test/cooked-part-reads.test.ts` proves that six concurrent readers and two later readers of one part make one network
read.
