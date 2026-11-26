# The colour pass presents an opaque world frame

> Written by: Claude (opus-nine133), 2026-11-26. State: done, meta QA 11-25 row 141.

Nine's ink graph (`NdJiehuaGraph`, nine-dragon `src/generators/compositeGraph.ts` `grade`) writes its scene's alpha to its
frame, and most of Nine's lit world draws with alpha under 8: 40 to 60% of a 48 px capture at the arrival view. On the
premultiplied game canvas the browser still showed the colour, with the page's near-black background (#050810) added
where alpha was low, but `core/worldWatch.ts` judged the frame `transparent` once 90% of it was clear. After a context
loss and restore (nine-dragon's GPU boot drill) both engines opened `World not drawn: the world still reads transparent 2
looks after control`, the RELOAD card. Plain boots under `wildshard dev` reported it in 2 of 6.

`render/displayColour.ts`: the colour pass's last write is now `gl_FragColor.a=1.0` (`OPAQUE_FRAME`), after the display
colour restore. Every shard's world reaches the screen through that pass, so no presented world frame has alpha under 1.
No colour moves: only the background that bled through low-alpha pixels goes. The before and after of one frozen frame
(same camera, same game time) are in the meta row. `display-colour.test.ts` fails when any write after it can set the
fragment's alpha again.
