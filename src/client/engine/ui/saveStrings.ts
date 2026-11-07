import { engineString } from '../../../shared/engine/strings';
/** Engine-owned Save screen strings. */
export const SAVE_STRINGS: { readonly title: string; readonly export: string; readonly import: string; readonly aside: string; readonly reload: string; readonly note: string; readonly imported: (n: number) => string; readonly skipped: (n: number) => string; readonly failed: string; } = {
  title: engineString('s_c210bfdf28ce'), export: engineString('s_6938f88f6b14'), import: engineString('s_40bc4983aca3'), aside: engineString('s_45f4dffea19f'), reload: engineString('s_02e74cba73d3'),
  note: engineString('s_f3cbd1ffea82'),
  imported: (n: number): string => engineString('s_716d7ae1e27b', [n]),
  skipped: (n: number): string => engineString('s_28d04b807530', [n]),
  failed: engineString('s_8488d17f9bcf'),
} as const;
