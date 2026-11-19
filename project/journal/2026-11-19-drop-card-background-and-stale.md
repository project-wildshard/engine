# 2026-11-19: no stale drop card, and a calm one for a background kill

Lane: buddy-engine (Coordinator, QA-FEEDBACK 11-19 row 11).

Jake's phone showed v0.1.50 on the main menu under a card that read "page ended unexpectedly in
the background · build e49a1e7dc · 2026-11-18T17:07:28Z". The card was right about what it
described: the previous page, from an older build, a day earlier. `DropNotes.take` read the dead
page's `stepOnce` device copy and greeted the new session with it whatever its age or build. No
stale client was reproduced, so the service worker was left alone.

(a) A drop from another build, or older than six hours, is history: `take` returns null for it,
both for a pending code-chosen exit and for the step copy. (b) An unexpected end of a page that was
hidden (`vis` = `hidden` in lastEnd, now `LastEnd.hidden`) is a new `background` kind: "Welcome
back", plain words that the phone closed the game to free memory, a calm tag colour. It is still
reported to Sentry, as non-fatal. Three tests in drop-modal.test.ts failed before the change.
