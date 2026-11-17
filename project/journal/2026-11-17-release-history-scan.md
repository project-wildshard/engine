# Scan new release branches from main

Two attempts at v0.1.37 (44172420162) reached the 25-minute hosted job
limit in the history scan. A new release ref has a zero `before` SHA.
On the blobless checkout that triggered a scan over the whole repository.
Use the main merge base for new release refs, as for plan refs, so every
release-only commit is scanned. Existing release pushes keep their own
`before` SHA. The staging successor has identical game and server source.
