# Enter MMO asks the door where first

> Written by: Claude (opus-entry), 2026-11-23

QA 11-23-b row 19: Enter MMO loaded Driftwood, then the door moved Jake to Signal Dunes behind a second loading screen. The
device hint (`grid.last-played`) was read only while its catalogue seal matched the page's catalogue exactly, and every staging
placement change voided it. The door now answers a pre-hello `where` word (prefix 14, `where: 1` in the world word) with the cell
the next join would seat; the title asks as it paints and Enter MMO boots that cell. The hint is read by its cell alone as the
fallback. Test: `test/enter-mmo-seat.test.ts`.
