// J473 row 4 (Jake, 2026-11-19 grill wave 3: "17 pt, up to 3 lines per page"): a dialogue line that wraps past three lines in
// the phone's talk box is split into pages at word breaks, so the box keeps one height and NEXT turns the page.

/** `line` as pages of at most `rows` wrapped lines, each line at most `maxWidth` wide by `widthOf` (a word wider than that
 *  takes a line of its own). A blank line, or no width to wrap in, is one page as it is. */
export function talkPages(line: string, widthOf: (text: string) => number, maxWidth: number, rows = 3): string[] {
  const words = line.split(/\s+/u).filter((word) => word !== '');
  if (words.length === 0 || maxWidth <= 0 || rows < 1) return [line];
  const wrapped: string[] = [];
  let row = '';
  for (const word of words) {
    const next = row === '' ? word : `${row} ${word}`;
    if (row !== '' && widthOf(next) > maxWidth) { wrapped.push(row); row = word; } else row = next;
  }
  if (row !== '') wrapped.push(row);
  const pages: string[] = [];
  for (let at = 0; at < wrapped.length; at += rows) pages.push(wrapped.slice(at, at + rows).join(' '));
  return pages;
}
