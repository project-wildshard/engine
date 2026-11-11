# A chunk's name names its final bytes

Main ci 43076662972 went red again on the immutable-chunk guard:
`late-TrainingArena-trainingDummyFigure-Ci9ql7Om.js` held different
bytes in the live preview (6f09c8b) and in main's build. The earlier
`shared` rename (60db3e56) removed one cause; this is the general one.

Vite writes `__vite__mapDeps`, a dynamic import's preload list, into
the importer in generateBundle, after rolldown has taken the importer's
content hash. Under the import map (J217) the list names stable keys,
but which keys it lists follows the shared-chunk layout under that
import, so a layout change moved the bytes and kept the name. A tab
open on the old build that lazy-loads the chunk would get the new list.

Fix: the first step after the bundle is written renames every chunk
that carries a preload list to its stem plus the hash of its final
bytes (8 base64url characters, rolldown's shape), and rewrites the
files that name it: the documents' import maps and preloads, Vite's
manifest and chunk-modules table, its source map and any chunk. Its
importers name it by key, so no other chunk's bytes move. Two builds
whose layout differs now get two names; equal bytes keep one.

Turning preload injection off was the other option; it would make
every lazy chunk's dependencies a request waterfall on phones.
