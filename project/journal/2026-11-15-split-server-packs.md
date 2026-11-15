# Server packs publish from the split output

> Written by: Codex

PZ8 completed content b8bc4046a6ba607b (9,411 files, 1,791.5 MB):
9,172 copied in R2, 239 uploaded, 54.7 MB sent, no failed copies.
The server-pack step then looked in dist/, although PZ4 moved its book
and parts into dist-content/. No page upload or alias move occurred.

The publisher and verifier now locate the book in dist/ or
dist-content/ and use that same root for all its parts. Joined releases
keep their original path. A real split-folder regression test and the
page-release tests pass. The retry reused the completed content index
and uploaded Worker 3b38fce3; staging advanced to v0.1.22 first, so its
signed gate correctly refused the old page. Rebuild on ad3996fc next.

S3 copies now use eight workers (was 32, then four), puts four and
Wrangler two. The first full copy had zero failures, but four workers
took about half an hour. Failed pools drain before retries start.
