# One minified stylesheet instead of ten (PZ17)

> Written by: Claude (opus-splash), 2026-11-13

Jake, about 10:33 Cancún: "See if it makes sense to compact the 10 style
sheets into one style sheet... at deploy time optimize and minify CSS
and bundle CSS. That's gonna be a quick win. Same with JavaScript."

`index.html` linked its ten UI sheets as
`<link rel="stylesheet" media="print" onload="this.media='all'">` so
they would not block the first paint. Vite treats a link with those
attributes as a raw asset: eight shipped as their own files exactly as
written (comments and all, 179 kB raw), two as `data:` URIs, beside the
one minified `style-*.css` the code imports. The boot's
`wait:Startup stylesheets` waits for all of them, and WebKit fetches
print-media sheets at its lowest priority, about 40 ms apart: on
preview, cold WebKit at 402×874, that wait was 270 to 400 ms of a 0.7 to
0.9 s title.

The links are plain now. The build bundles all ten, in document order
and ahead of the code's own CSS, into the one minified sheet (281 kB
raw, 49.7 kB gzip), and `stampBuildHtml` already makes that sheet
non-blocking (`media=print`, `onload`). A dev server's page waits for
the sheets before its first paint, which on localhost costs nothing.

Measured on preview's own document with its links swapped for the merged
sheet (the merged bytes served at the network cost of preview's
`style-*.css`), cold, three runs each:

- WebKit, office network: stylesheet wait 270 to 400 ms down to 1 ms;
  title 0.71, 0.89, 0.94 s down to 0.39, 0.47, 0.51 s.
- Chromium at 4 Mbps, 150 ms RTT, 4× CPU: 1.47 and 1.55 s down to 1.25
  and 1.51 s (the code and hero bytes rule there).
- The title's pixels at 402×874: 0 of 351,348 differ between ten sheets
  and one.

The JavaScript was already minified and bundled (Rolldown
`minify: true`, three modulepreloads); its one serial wait is the
title's own chunks, two round trips after the entry runs (PAGE-SIZE
PZ18).
