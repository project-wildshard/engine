# S12: tier texture sizes by mip trim (opus-s12)

Jake said yes to S12 (J330). First slice: the cook picks a phone texture size from one master by dropping the KTX2 mip
levels above it, no re-encode. Pine's phone table today is 28.3 MB of KTX2/GLB files (32.2 MB on the GPU), mostly S4's
hand-made 6×6 / 512 sets. Trimming the desktop masters to 512 instead gives 30.3 MB (35.4 GPU): trim alone lands 7%
over, because the masters are UASTC (4×4) and the hand sets are 6×6. So retiring the hand sets needs the cook's own
6×6 encode (S12b); trim gives the size, 6×6 gives the format. Not wired into shardCook yet: tiers share mount URLs, so
per-tier bytes need per-tier names and table rows (S12a).
