# Engine fixtures stop carrying requires.sdk

- FORMAT-PRUNE FP33 deletes `requires.sdk` from the shard schema (shard-format
  `plan/fe13`). Two engine fixtures still carried it and would fail to parse
  once engine pins that format: the frozen Template gameplay slice and the
  frozen SDK decision-worker product.
- The slice drops the field and its declared source hash is re-sealed with
  the format's own formula. The worker fixture keeps its frozen input hash
  by writing `sdk: '0.1'` back only for the hash, and strips it from the
  frozen shard before parsing.
- Both pass on today's format 0.78.0 and on the linked FP33 format, so this
  lands first and the format pin later goes green.
