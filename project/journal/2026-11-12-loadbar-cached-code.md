# Loading Start row: code a cache answered counts (opus-loadbar2)

Jake, 20:04 Cancún, v0.1.13 `b3e9a56` on LTE, Nalati: "At the start, it says like 75%, this is 0 to 31." Start read
`0 / 31 code files · 0.0` at 75 %, then 25 % after a reload. The percent was v0.1.13's mix of LS1 boundaries and code
bytes, (6 + 0) / 8 and (2 + 0) / 8; `827ffbdb` already paints the code-byte ratio alone, and `loading-row-ratio.test.ts`
now pins 0 % with an empty bar at 0 bytes for 2 and 6 boundaries (red on `827ffbdb^`).

The zero itself was a miscount. WebKit gives `decodedBodySize` 0 for a cached or service-worker answer, and the service
worker precaches `/b/c/` code, so a repeat visit's arrived code counted as none (seen with Playwright WebKit on prod). A
timeline row with no size now counts its compiler size; Chromium's row for a failed fetch (`responseStatus` 0, now in
the captured fields) still counts nothing. Captures at 402×874: `~/.cache/wildshard/plan-artifacts/loadbar2/`.
