export const HOME_GEOMETRY_INPUTS: readonly string[];
export const HOME_GEOMETRY_PACKAGES: readonly string[];
export function homeGeometryHash(read: (path: string) => Buffer): string;
export function homeGeometryRevision(root?: string): string;
