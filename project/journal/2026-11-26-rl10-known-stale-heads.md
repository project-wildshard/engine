# Name the two stale heads in the v0.1.98 staging gate

The current migration chain changes the identity digests still recorded
for Nalati and Nine Dragon. The API keeps those rows untouched. The
v0.1.98 staging pack wait reports the exact two missing originals and
the re-pack that replaces each. The cook still checks provenance, and
production and every other build still require every advertised pack.
