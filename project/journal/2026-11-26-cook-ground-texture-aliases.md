# The phone ground aliases share one manifest file

Nine Dragon's phone cook had two references to the same ground ARM KTX2. The full-size and `_1k` image names both select the same phone encode. The cook preserves those aliases in the discovery table and lists their shared file once per manifest, keeping the first row. If two selections name a URL with different hashes, the cook names the conflict and refuses the manifest.

The regression cooks a small ARM image through the same path. It checks that both aliases still resolve and that the separate layer file remains available.
