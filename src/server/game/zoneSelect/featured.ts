import curated from './featured.json' with { type: 'json' };

// J461 and J470: the room server owns the editorial order for both channels.
export const FEATURED_ZONES: readonly string[] = curated;
