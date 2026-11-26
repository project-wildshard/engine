export interface WeaponTransfer { class: string; from: string; runtime: string; base: string; owner: string }
export const WEAPON_TRANSFER_LIST: string;
/** Immutable class move records proved against the predecessor source tree. */
export const CLASS_MOVE_LIST: string;
/** Complete class syntax identities, including anonymous factory classes. */
export function classMoveSites(text: string, filename: string, root?: string): { hash: string; name: string; baseFile: string | null; heritage: string }[];
export const WEAPON_TRANSFER_BOOTSTRAP: Record<string, WeaponTransfer>;
export function compareWeaponTransfers(before: Record<string, WeaponTransfer>, after: Record<string, WeaponTransfer>): string[];
export interface ShardCoupling { counts: Record<string, number>; sites: Record<string, string[]>; transfers?: { from: string; site: string; class: string; base: string }[]; verbatimMoves?: { from: string; site: string; base: string }[] }
export function shardCoupling(root?: string): Record<string, ShardCoupling>;
export function compareCoupling(baseline: Record<string, ShardCoupling>, candidate: Record<string, ShardCoupling>): string[];
