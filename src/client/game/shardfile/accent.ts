/** The HUD's accent variables for an accent hex (the `--ws-cyan` family in src/client/engine/ui/styles/base.css). */
export function accentVars(hex: string): Readonly<Record<'--ws-cyan' | '--ws-cyan-dim' | '--ws-cyan-line' | '--ws-cyan-faint', string>> {
  const n = Number.parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return { '--ws-cyan': hex, '--ws-cyan-dim': `rgba(${r}, ${g}, ${b}, 0.55)`, '--ws-cyan-line': `rgba(${r}, ${g}, ${b}, 0.35)`, '--ws-cyan-faint': `rgba(${r}, ${g}, ${b}, 0.14)` };
}
