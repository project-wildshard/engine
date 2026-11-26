# The installed-cook test runs its cases side by side (QA 11-25 row 83)

> Written by: Claude (opus-chunk3)

`test/cook-astc6-installed.test.ts` went over its 60 s line on main three times (60.5, 64.4 and 62.8 s). The CI log
puts the time in two places. The package cook took 41 s (pack 9.5, install 14.7, the broken cook 8.3, the healed cook
8.3). The registry case took 16.5 s, and nearly all of that is idle: it holds its first request open until npm's real
15 s `--fetch-timeout` gives up and retries. The five cases ran one after another, so that idle wait queued behind the
CPU work. Each case has its own root, its own npm cache and its own port 0 server, so they now run concurrently. Every
proof stays as it was, including the real install arguments. Locally the file drops from 30.5 s to 16.7 s.
