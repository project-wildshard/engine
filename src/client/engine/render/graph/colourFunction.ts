import { parseColourFunction } from '@wildshard/format/colourFunction';
import { validateGraph, type GraphLiteral, type GraphRef } from '@wildshard/format/materialGraph';
import type { Material } from 'three';
import { patchShader, PATCH_ORDER } from '../shaderPatches';

/** Client-only colour graph on an existing material. A replacement retains the
 * original function's call sites; decoration covers albedo and emission. */
export function materialColourGraph(material: Material, id: string, input: unknown, replaceExisting = false): void {
  const row = parseColourFunction(input), code = colourGraphFunction(row);
  const declaration = new RegExp(`vec3\\s+${row.name}\\s*\\(\\s*vec3\\s+${row.input}\\s*\\)\\s*\\{[^}]*\\}\\n`, 'u');
  patchShader(material, id, PATCH_ORDER.decorate, shader => {
    if (replaceExisting) {
      if (!declaration.test(shader.fragmentShader)) throw new Error(`Missing colour function ${row.name}`);
      shader.fragmentShader = shader.fragmentShader.replace(declaration, code.trimStart());
    } else {
      shader.fragmentShader = code + shader.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>\n  diffuseColor.rgb = ${row.name}(diffuseColor.rgb);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance = ${row.name}(totalEmissiveRadiance);`);
    }
  }, { key: prior => `${prior}|${id}` });
}

/** A pure admitted arithmetic graph as a standard-material colour function.
 * No shader text enters this API. Resource, control-flow and geometry nodes
 * refuse; original material lighting, skinning, fog and hit flash stay intact. */
export function colourGraphFunction(input: unknown): string {
  const row = parseColourFunction(input), checked = validateGraph(row.graph);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const bound = new Set<string>(), types = checked.types;
  const brackets = (value: string): string => row.layout === 'spaced' ? `( ${value} )` : `(${value})`;
  const scalar = (value: number): string => Number.isInteger(value) ? `${value}.0`
    : Math.abs(value) <= .001 && value !== 0 ? value.toExponential().replace('e+', 'e') : String(value);
  const literal = (value: GraphLiteral): string => typeof value === 'number' ? scalar(value)
    : typeof value === 'boolean' ? String(value) : `vec${value.length}${brackets(value.map(scalar).join(', '))}`;
  interface Expression { text: string; priority: number }
  const atom = (text: string): Expression => ({ text, priority: 3 });
  const enclose = (value: Expression, priority: number): string => value.priority < priority ? brackets(value.text) : value.text;
  const operators: Readonly<Record<string, { symbol: string; priority: number }>> = {
    add: { symbol: '+', priority: 1 }, sub: { symbol: '-', priority: 1 }, mul: { symbol: '*', priority: 2 }, div: { symbol: '/', priority: 2 },
  };
  const functions = new Set(['dot', 'max', 'min', 'clamp', 'smoothstep', 'mix']);
  let expansion = 0;
  const emit = (ref: GraphRef, depth = 0): Expression => {
    if (depth > 64 || ++expansion > 4096) throw new Error('Colour expression expansion exceeds its bound');
    if (typeof ref !== 'string') return atom(literal(ref));
    if (bound.has(ref)) return atom(ref);
    const node = row.graph.nodes[ref];
    if (node === undefined) throw new Error(`Missing colour expression ${ref}`);
    const refs = node.in ?? [], args = refs.map(value => emit(value, depth + 1));
    if (node.op === 'param' && node.param === row.input) return atom(row.input);
    if (node.op === 'const' && node.value !== undefined) return atom(literal(node.value));
    const operator = operators[node.op], a = args[0], b = args[1];
    if (operator !== undefined && a !== undefined && b !== undefined) {
      // The graph's safe division contract is explicit in these colour rows.
      const divisor = refs[1], guard = typeof divisor === 'string' ? row.graph.nodes[divisor] : undefined;
      if (node.op === 'div' && !(typeof divisor === 'number' && divisor !== 0)
        && !(guard?.op === 'max' && guard.in?.some(value => typeof value === 'number' && value > 0))) throw new Error('Colour division needs a positive floor');
      const right = enclose(b, operator.priority + 1);
      return { text: `${enclose(a, operator.priority)} ${operator.symbol} ${right}`, priority: operator.priority };
    }
    if (node.op === 'swizzle' && a !== undefined) return atom(`${enclose(a, 3)}.${(node.mask ?? '').replaceAll('x', 'r').replaceAll('y', 'g').replaceAll('z', 'b').replaceAll('w', 'a')}`);
    if (node.op === 'combine') {
      const type = types.get(ref);
      if (type === undefined || !type.startsWith('vec')) throw new Error('Colour combine needs a vector');
      const values = args.map(value => value.text);
      const broadcast = values.length === Number(type.slice(3)) && new Set(values).size === 1;
      return atom(`${type}${brackets(broadcast ? values[0] ?? '' : values.join(', '))}`);
    }
    if (functions.has(node.op)) return atom(`${node.op}${brackets(args.map(value => value.text).join(', '))}`);
    throw new Error(`Unsupported pure colour operation: ${node.op}`);
  };
  const statements: string[] = [];
  for (const id of row.locals) {
    const type = types.get(id);
    if (type === undefined || type === 'bool') throw new Error(`Invalid colour local ${id}`);
    statements.push(`${type} ${id} = ${emit(id).text};`); bound.add(id);
  }
  const output = row.graph.stages.surface?.colour;
  if (output === undefined) throw new Error('Colour expression lacks its output');
  statements.push(`return ${emit(output).text};`);
  return row.layout === 'compact' ? `vec3 ${row.name}(vec3 ${row.input}){ ${statements.join(' ')} }\n`
    : `\nvec3 ${row.name}${brackets(`vec3 ${row.input}`)} {\n  ${statements.join('\n  ')}\n}\n`;
}
