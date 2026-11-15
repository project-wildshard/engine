# Nine's boot trace writes (NINE-DRAGON-BENCHMAX NB2, mini-nine)

- NB1 on staging v0.1.21 (Mac mini, x4, cold): control 47-50 s, `shaders` 14.5-15.0 s, `firstFrame` 15.8 s. A CPU
  profile put ~12 s of each stage under the loader's `paint` → `recordBootProgress` → `saveStorage('device').setItem`,
  in valibot: the boot trace's detail (`… · N programs`) changes every progress tick, so every tick wrote it.
- The write was slow, not frequent: `jsonSchema` is a recursive `v.lazy`, and `shape.ts` treated every lazy as opaque,
  so `known` / `keepUnknown` walked the whole record through `optionOf` (each union option: `known`, then a full
  `v.is`, then `known` again), exponential in depth. ~21 ms a write at x1, ~85 ms at x4.
- Fix: a lazy getter that declares no input can't depend on it, so `reaches()` walks its answer (once per lazy). Plain
  JSON then reaches no object and is returned as is; an input-free lazy that reaches a strict object still trims.
  21.5 to 0.13 ms a write. Every save on the JSON slots gets it, not only the boot trace.
