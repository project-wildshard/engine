/**
 * NINE-DRAGON-BENCHMAX NB19 (mini QA 11-16 row 42): the inline runtime candidate this page owns (`wildshard dev`,
 * `wildshard prepare`), recorded when entry selects it (clientSource.ts `selectInlineRuntime`). Its in-page server reads the
 * candidate's own server files beside it, hash-verified as every server input is, because this build's server book names
 * only the pinned revision's packs (and an author's preparation archive drops those). No other slug, and no page that
 * owns no inline candidate, changes where its server reads.
 */
let owned: string | null = null;

export function ownInlineCandidate(slug: string): void { owned = slug; }

/** Whether `slug` is the inline candidate this page owns. */
export function ownsInlineCandidate(slug: string): boolean { return owned !== null && owned === slug.replace(/^_/u, ''); }
