# Sorts without garbage, and what is left of Nine's walk

MEMORY-STRUCTURE STR20, third pass (mini-memstruct-m3c). Two allocators
that are certain and ours:

- three sorts every render list with `Array.prototype.sort`, and V8's
  sort copies the list into a fresh work array on each call (~0.13 MB/s
  of Nine's walk). `renderListSort.ts` gives each list's three arrays an
  own stable merge sort over one kept scratch array.
- `gltfOpaqueSort` returned the fractional depth difference, and the
  sort builtin boxed it on every compare (~0.09 MB/s). It returns the
  sign now; NaN is still a tie.

The rest of Nine's ~6.5 MB/s is not one site. A profile with Turbofan
inlining off (`--js-flags=--no-turbo-inlining`) shows where the inlined
bytes really sit: `channelPrograms.evaluate`'s half MB/s is the ports'
`apply` writing doubles through `Reflect.set`, and the uniform setters'
is the double reads of three's value objects. Both are numbers boxed at
the boundary with three's object model (uniform `value` fields and
vectors hold changing doubles in fields V8 keeps tagged), not objects we
make. About 27% of the walk's bytes sit under streaming stacks (tile
placement, the wire's decode, first texture uploads), and about a
quarter has its leaf in three.js or a builtin under three.

A trial that made the vec3 and scalar setters one shared function each
(instead of a closure per uniform) moved nothing: 6.54 against 6.56
MB/s, so the setters were not stuck in a baseline tier.
