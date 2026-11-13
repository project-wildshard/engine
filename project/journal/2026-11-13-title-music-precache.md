# The title's music comes with the shell

AUDIO AU3. The worker's shell precache (`shellFiles` in
`scripts/app-build/serviceWorker.ts`) held the document, icons, title
art and Latin fonts, and no music, so the title's piano track was
streamed on first play and missing on a title opened offline. It now
adds the piano style's `title` slot (`music.json` names the file,
`title-3d1f713a.m4a`, 762 KB): the one style left after AU16. No other
style's music joins the shell.

My first pass called this a lane, thinking a split build (PZ4 moves
engine art to `dist-content/`) would fetch a page path that is gone.
It wouldn't: with a content base the bake already moves every content
path in the shell list to the content list, precached from the base
(PZ10). `test/title-music-precache.test.ts` covers both, red first.
