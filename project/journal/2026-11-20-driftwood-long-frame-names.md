# Name each long Driftwood phone frame

`route-bench --frames` already logged every long frame with its links, uploads and update split, but a frame could still
be a garbage collection, which the page can't see. The inspector driver now turns on Web Inspector's Heap agent for the
route and reads JavaScriptCore's collections back on the page clock. Three forced collections, each between two
`performance.now()` reads, tie the inspector's stopwatch to the page. The frame log also keeps each frame's slowest
single draw, and `nameLongFrames` names every frame over 50 ms as gc, compile, upload, update, render or other.

Six cooled iPhone 13 boots at the 30 cap had 22 to 37 collections each, none of them 10 ms or more, so GC isn't what
is left at the dock. What's left is the outer road deck's first draw (a 24.6 MB upload, render 24 to 86 ms), single
system updates of 24 to 38 ms, and a few frames with no game work in them.
