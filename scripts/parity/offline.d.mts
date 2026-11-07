import type { RecordValue } from './value.mjs';
import type { compare } from './compare.mjs';

export function compareOffline(current: RecordValue): ReturnType<typeof compare>;
export function failureReasons(checked: ReturnType<typeof compare>): string[];
