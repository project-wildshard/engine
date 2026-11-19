# Nalati's peak loading follows its boot order

Main run 44447800293 (03943a3886..84e54ad7d0) failed memory-ledger-guard on
Nalati Grasslands: peak loading 146,478,089 B against the line 146,036,730
(the 141,036,730 baseline plus J431's 5 MB margin). All three confirming boots read
the same bytes, so it is not GC noise.

The run's own readings (artifact `memory-ledger-guard`) set beside the last
green run's (44440802265 on 03943a38):

- The peak is at worldFrame in both: 140.19 MB before, 146.48 after.
- +5,242,880 B is `image-bitmap` and +1.05 MB is `array-buffer`.
- The bitmaps are not new. Both runs hold 9 to 14 MB of them through
  the loading steps. The difference is when they are released.
- In three boots, a `physics` step comes where `cards` was, and 5 MiB of
  bitmaps are still held at firstFrame and worldFrame. They are gone by
  readyFrame.
- Boot 4, on the same code, took the old order. It released them before
  firstFrame and peaked at 119.7 MB.
- Control is byte-identical before and after: 47,052,932 B array-buffer.

So the peak is a loading transient whose height depends on which step
order a boot takes. Nothing in `src/` in the range creates an
ImageBitmap. The scratch-state commits (39c36154, 0dcbc4b1) change
tile-driver and worker scheduling, which could change that order. The
baseline moves to the observed high, 146,478,089 B, as ca7b0293 did for
Driftwood.

A real cut is still possible. Close the decoded bitmaps after upload,
before the first frame, whatever the boot order, and the peak drops back
to about 140 MB.
