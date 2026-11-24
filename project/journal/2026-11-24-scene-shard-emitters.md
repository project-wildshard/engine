# 2026-11-24: emitters and fields on scene shards (FORMAT-PRUNE FP49)

> Written by: Claude (opus-fp49)

`light.emitters` and `weather.fields` had one pinned user, Sunscar Dunes, and needed its `world/scenes` and quest page.
A three.js scene shard has neither, so FP49 lets the two features run without them: a scene shard's emitter lights hang
under one group on the plan root, an emitter row's gains follow a host f64 field (format 0.78.0), and a weather field
reads the shard's declared quest by slug when no quest page bound one. Glowfen's lantern run is the first user: its six
lanterns ease a `glow` field, and the shrine's light wakes with it (sharddev `world.field` and `world.emitter`).

Follow-up, same day: Glowfen's first local boot stopped at "Emitters require the scene feature". Admission asked every
emitter plan for `world.scenes`; it now asks only a product that carries `world/scenes`, and a test holds both cases.
