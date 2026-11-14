# Phone rows the product dropped: made from their source (opus-fixfwd5)

- SHARD-SIZE S12d, GRID-CROSSING GC30b. Sky Reach dropped its hand-made
  phone set (`d8ade75`): rev 2 and 3 name 21 phone GLB targets they no
  longer carry, so `pins.ts install` refused them ("KTX2 table names a
  missing file"), and the cook kept those rows, which would 404 on a
  phone.
- The cook (`phoneTier`) now makes a phone row's file from the row's
  own source when the target is absent and both are GLB or both KTX2.
- Admission (`missingKtx2Targets`) counts such a target as served when
  its source is (`phoneRowSources`). Pine rev 1's local check names 78
  missing, not 81: three of its rows the cook now makes.
- Far Reach rev 3 is not pinned here: with it the app build's phone
  gate reads 26.33 MB against Far Reach's 25.98 MB ceiling (the source
  GLBs are served as they are, where rev 1's twins were cooked 6x6).
  The pin waits on a shrink or Jake's raise.
