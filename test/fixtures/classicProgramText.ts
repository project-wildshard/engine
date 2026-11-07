import * as THREE from 'three';

/** a macro's value: `true` for a bare `#define NAME` */
export type MacroValue = string | number | true;

/**
 * The classic program text three compiles for one draw (NF18): a graph material's stage source with three's chunks
 * expanded (`#include <name>` from `THREE.ShaderChunk`) and its conditionals resolved under `defines` — the macros
 * three's program prefix sets for that draw (`USE_INSTANCING`, `USE_INSTANCING_COLOR`, `USE_SKINNING`, `USE_FOG`…) and
 * the material's own `defines`. Tests read what a draw really runs, as the node handler's per-object build once showed.
 * An undefined macro reads 0 in an `#if`, as the GLSL preprocessor does.
 */
export function classicProgramText(source: string, defines: Readonly<Record<string, MacroValue>>): string {
  const macros = new Map<string, MacroValue>(Object.entries(defines));
  const out: string[] = [];
  /** per open conditional: whether its enclosing block is live, whether an arm was taken, whether the current arm is live */
  const stack: { readonly outer: boolean; taken: boolean; live: boolean }[] = [];
  const live = (): boolean => stack.every(s => s.live);
  for (const line of expandIncludes(source, 0).split('\n')) {
    const directive = /^\s*#\s*(\w+)\s*(.*)$/u.exec(line), name = directive?.[1], rest = (directive?.[2] ?? '').replace(/\/\/.*$/u, '').trim();
    if (name === 'if' || name === 'ifdef' || name === 'ifndef') {
      const outer = live(), on = outer && (name === 'if' ? condition(rest, macros) : name === 'ifdef' ? macros.has(rest) : !macros.has(rest));
      stack.push({ outer, taken: on, live: on });
    } else if (name === 'elif' || name === 'else') {
      const top = stack.at(-1);
      if (top === undefined) throw new Error(`#${name} without #if`);
      top.live = top.outer && !top.taken && (name === 'else' || condition(rest, macros));
      top.taken ||= top.live;
    } else if (name === 'endif') {
      if (stack.pop() === undefined) throw new Error('#endif without #if');
    } else if (!live()) continue;
    else if (name === 'define') {
      const m = /^(\w+)(?:\s+(.*))?$/u.exec(rest);
      if (m?.[1] !== undefined) macros.set(m[1], m[2] ?? true);
      out.push(line);
    } else if (name === 'undef') { macros.delete(rest); out.push(line); }
    else out.push(line);
  }
  if (stack.length > 0) throw new Error('unterminated #if');
  return out.join('\n');
}

function expandIncludes(text: string, depth: number): string {
  if (depth > 8) throw new Error('#include nests too deep');
  return text.replaceAll(/^[ \t]*#include <(\w+)>/gmu, (_, chunk: string) => {
    const body: unknown = Reflect.get(THREE.ShaderChunk, chunk);
    if (typeof body !== 'string') throw new Error(`unknown chunk ${chunk}`);
    return expandIncludes(body, depth + 1);
  });
}

/** an `#if` / `#elif` expression: defined(), !, &&, ||, comparisons, parentheses, integers and macros (undefined: 0) */
function condition(source: string, macros: ReadonlyMap<string, MacroValue>): boolean {
  const pattern = /defined|\w+|&&|\|\||[<>=!]=|[()<>!]/gu, tokens = source.match(pattern) ?? [];
  if (source.replaceAll(pattern, '').trim() !== '') throw new Error(`#if ${source}: outside the supported subset`);
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const value = (word: string): number => {
    if (/^\d+$/u.test(word)) return Number(word);
    const v = macros.get(word);
    return v === undefined ? 0 : v === true ? 1 : Number.isFinite(Number(v)) ? Number(v) : 1;
  };
  const unary = (): number => {
    const t = tokens[at++];
    if (t === undefined) throw new Error(`#if ${source}: unexpected end`);
    if (t === '!') return unary() === 0 ? 1 : 0;
    if (t === '(') { const v = or(); if (tokens[at++] !== ')') throw new Error(`#if ${source}: missing )`); return v; }
    if (t === 'defined') {
      const paren = peek() === '('; if (paren) at++;
      const word = tokens[at++] ?? ''; if (paren && tokens[at++] !== ')') throw new Error(`#if ${source}: missing )`);
      return macros.has(word) ? 1 : 0;
    }
    return value(t);
  };
  const compare = (): number => {
    let v = unary();
    for (let op = peek(); op === '<' || op === '>' || op === '<=' || op === '>=' || op === '==' || op === '!='; op = peek()) {
      at++; const r = unary();
      v = (op === '<' ? v < r : op === '>' ? v > r : op === '<=' ? v <= r : op === '>=' ? v >= r : op === '==' ? v === r : v !== r) ? 1 : 0;
    }
    return v;
  };
  const and = (): number => { let v = compare(); while (peek() === '&&') { at++; const r = compare(); v = v !== 0 && r !== 0 ? 1 : 0; } return v; };
  const or = (): number => { let v = and(); while (peek() === '||') { at++; const r = and(); v = v !== 0 || r !== 0 ? 1 : 0; } return v; };
  const result = or();
  if (at !== tokens.length) throw new Error(`#if ${source}: trailing ${tokens.slice(at).join(' ')}`);
  return result !== 0;
}
