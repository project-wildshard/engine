# Own a logical save without transporting it

The native object-restore branch currently serializes a logical snapshot,
compresses/base64-encodes it, then immediately parses/inflates it into a
legacy number array. Those bytes never cross a transport boundary.

On actual Nalati native state, four alternating rounds over 22,117,708
physics bytes cost 3,399.4 ms through that round trip versus 57.6 ms for
typed admission. Legacy array inputs cost 3,528.5 versus 215.1 ms. Exact
metadata and native bytes agree. This is an admission-path measurement,
not an achieved whole-suite saving while callers await their owner.

The public admitSimSnapshotBytes API reuses the writer's existing strict
JSON-tree/schema/identity and flat-byte checks, including its owned copy.
It rejects empty physics at the same point as encoding. It publishes no
wire and makes no promise about a wire-size budget. Stored strings still
need the strict decoder; fresh-host and restore registration checks stay.

The outside-hook proof first failed because the public export was absent.
It now boots a real admitted Nalati product, proves detached bytes and
metadata, preserves signed zero/infinities, retains eight matching strict
refusals, restores two independent worlds and compares twenty full future
checkpoints. Its current legacy caller bridge is explicit. Runtime about
6.2 seconds. Existing five-file/56-case baseline passes at 34.62 seconds;
engine-rule alone is 32.822 seconds. Caller integration belongs to pinefix2
in the meta plan's HS4 handoff. No quarantined test body/policy was changed.

Other codec experiments preserve bytes but show no material gain: deduped
metadata validation barely changes decode, native JSON is about 3 percent
on one aggregate and noisy combined, and zero-window hashing regresses.
None is retained. Reduce real transport work before changing dictionaries
or weakening validation, deadlines, resident counts or physics samples.
