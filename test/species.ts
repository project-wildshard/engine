import { expect } from 'vitest';
// Registers every species exactly as src/client/engine/entities/AnimalFactory.ts does (eager glob over the folder) without pulling in
// the factory itself (materials, baked textures, the sky). The glob runs when this module loads; `loadSpecies()` makes
// the dependency explicit at the call site and returns the files it registered.
const modules = import.meta.glob(["../src/client/engine/entities/species/*.ts", "../src/shared/engine/entities/species/*.ts","!../src/shared/engine/entities/species/registry.ts","!../src/client/engine/entities/species/loft.ts"], { eager: true });
expect(Object.keys(modules).length).toBeGreaterThan(0);

export function loadSpecies(): string[] { return Object.keys(modules); }
