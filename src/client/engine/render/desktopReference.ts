import reference from '../../../../budgets/desktop-reference.json' with { type: 'json' };

/** X7 same-API OpenCL throughput projection, captured 2026-10-01; not measured RTX 3060 WebGL. */
export const DESKTOP_REFERENCE: typeof reference = reference;
export const desktopFloor = (): number => DESKTOP_REFERENCE.m5Score * DESKTOP_REFERENCE.k3060;
