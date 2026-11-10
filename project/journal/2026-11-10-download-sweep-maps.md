# Bind the sweep to the promoted shell's engine source

The promoted solo artifact is 0641eaa-mwavaean, with engine a479f383.
The legacy gate used --rev for both the document and git show. Reading
the shell commit's grid source in engine reproduces exit 128. Its maps
also live at b/c, indexed by .vite/chunk-modules.json; the old lookup
only searched b/<build> or assets and found none on this actual artifact.

--source-rev now names the pinned engine source separately. The default
remains --rev for a direct engine build. The document still binds to the
full shell build. A source map must carry the exact Git text of every
neighbour-span file; the source markers and request oracle are unchanged.
The current chunk index chooses the relevant maps, with the original
directory layout retained for builds predating that index. A different
full build suffix refuses rather than matching only seven characters.

The authenticated release artifact 13779263908 from run 42848130723 was
streamed without retaining its large ZIP or tar. All 2,739,220,480 tar
bytes hash to the recorded promoted archive:
807e910bba2c40e8a93cb4a542c32ba779c765a1c0cfc58d77d1c44f724cfc04.
Only 37,080,796 diagnostic bytes, including 122 maps and metadata, remain
in owned scratch. This is the promoted artifact, not a local rebuild.

The outside-hook source-maps-proof.mjs reads that real artifact and Git.
It refuses a shell revision as engine source, a different full build,
changed source contents and an empty chunk index. Restoring the actual
source permits the binding. The grid file is byte-identical at v0.1.1
and a479; the proof explicitly accepts that older identical file rather
than falsely claiming it as a negative control. All five actual source
anchor pairs resolve. No browser or game event is involved, and no
DOWNLOAD reading or rendered trace is claimed by these setup checks.
