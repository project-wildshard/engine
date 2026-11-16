# Pine Hollow's purple far trees (QA-FEEDBACK-2026-11-15-mini 42, mini-pinetrees)

- Pine's goldens 20 (grid+170+170) and 24 (hands-up) went red after 80e9cb9d (NB5): `placedLodScale` 0.6 also scaled the
  forest tree set's LODs, whose bands are already the phone's own (80 / 130 m) and whose dissolve shaders fade on them. The
  phone drew lo cards from 48 m and the impostor from 78 m, where its purple-fringed atlas shows. A/B at 80e9cb9d~1 / 80e9cb9d
  named it. `ModelLod.tierScaled: false` keeps a level's authored distances; the tree set's two levels set it, every other
  placed model keeps NB5's phone scale.
