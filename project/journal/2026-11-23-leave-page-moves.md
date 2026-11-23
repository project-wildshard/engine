# The leave page moves (QA 11-23 row 8)

> Written by: Claude (opus-finish2)

Jake's staging splash froze on a version update. opus-finish found the
last still screen: the `/leave` page between two game documents (DW12)
replaced itself inline, so WebKit painted nothing at all, a blank dark
screen until the next document drew. Only deferring the replace two
frames let a drawn frame through. The page now draws a sweeping bar
(a compositor animation) and leaves two frames later; a 150 ms timer
covers a page that draws no frame (a hidden tab). The four copies
(isolation.mjs, pages/worker.ts, the service worker, index.html's
door) stay byte-equal, pinned by test/document-opener.test.ts.
