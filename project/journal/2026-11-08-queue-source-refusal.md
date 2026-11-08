# Keep the changed path when a queued hook refuses

Actual immutable queue16 ran every gate green but refused publication
because generation changed captured source. Its durable error omitted the
paths before managed cleanup. The required renderer stamp has a separate
owner forward86b7e10; this change does not relax source verification.

The outside-hook real Git CLI proof now also queues a fourth captured
ancestor whose normal hook modifies tracked value.json and returns zero.
Before this fix it correctly refuses, but the new diagnostic assertion is
red because its error contains no path. Afterward the refusal names the
changed working-tree path (and changed HEAD/tree when relevant), while
keeping the source snapshot, original hook failure and post-push verdict
states separate. Two prior ancestors still push in FIFO order, dirty lane
bytes stay excluded, the failing third hook still refuses, and every
managed capture is removed. All four actual attempts finish in1.871s.

No bypass, force, gate omission or failed-source receipt is introduced.

Focused lint exposes two unnecessary template-string escapes in the new
proof; the actual queue19 normal gate also refuses them, draining peers
at30.2s. Remove the escapes, preserve the identical runtime JSON and
rerun the same real four-attempt proof (1.741s), focused lint and the
full layered compiler. This forward precedes E7's final queue boundary;
optional engine publications remain held through E7's push.
