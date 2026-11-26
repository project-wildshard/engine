/** Workers static assets' file limit a page version stays under (PV9). */
export const MAX_PAGE_FILES: number;
/** PV9: refuse a page whose code is not under `builds/<engineVersion>/<build>/` and `builds/shared/`. */
export function checkCodeLayout(outDir: string): { own: string; files: number };
