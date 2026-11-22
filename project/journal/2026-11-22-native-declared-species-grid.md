# A native grid page declares its own species (K4, Pine r10)

opus-pine2: v0.1.67's local K4 stopped Pine's deep link at finish on "unknown animal kind 'deer' (registered: boar,
bear)". Pine r10 has no species programme and no plan feature that registers species (OF23e4). The standalone client
declared such a page's rows (`declaredNativePage`), but a grid cell's entered kit only asked data pages
(`pageDeclaresOwnSpecies`), so on the grid nobody registered deer. `nativeDeclaresOwnSpecies` now names that page; the
regional world loads its declared bodies' materials (bodies only, no data page binds them) and the entered kit registers
the rows and keeps the hull book's kit, as standalone does.
