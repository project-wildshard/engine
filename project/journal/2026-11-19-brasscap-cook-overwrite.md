# Keep cooked loose files by upload

Staging placement serial 50 pointed to Brasscap rev 9 when the v0.1.48
cook worker wrote an older raw head into the shared descriptor. The
shared bytes matched the older head's loose copy. Staging rev 9's loose
copy stayed intact and supplied the repaired descriptor. Production
kept the baked descriptor for its signed placement.

The cook now publishes loose descriptors and recorded programs only
under the raw upload hash. The release bake takes the exact header and
program paths from its cook index. Old indexes without a loose prefix
still read their original paths.
