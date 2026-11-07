import * as v from 'valibot';
import { parseClientChannels, parseHeldMeleePhase, parsePrivateScene, parseWorldSceneBindings } from '@wildshard/format/clientChannels';
import { isJsonData } from '@wildshard/format/json';
import type { HeldMeleeRecipe } from './weaponFamily';

const name = v.pipe(v.string(), v.regex(/^[a-zA-Z][a-zA-Z0-9.-]{0,127}$/u));
const path = v.pipe(v.array(v.union([v.pipe(v.string(), v.regex(/^[A-Za-z][A-Za-z0-9_-]*$/u),
  v.check(value => !['constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments'].includes(value))),
  v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1024))])), v.minLength(1), v.maxLength(16));
const binding = v.strictObject({ id: name, from: v.strictObject({ owner: name, path, optional: v.exactOptional(v.boolean()) }),
  args: v.exactOptional(v.pipe(v.array(v.custom<unknown>(isJsonData)), v.maxLength(16))), result: v.exactOptional(path), requires: v.exactOptional(name),
  bytes: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  copyGeometry: v.exactOptional(v.boolean()), indexArray: v.exactOptional(v.boolean()), emptyGeometry: v.exactOptional(v.boolean()),
  discardGeometry: v.exactOptional(v.boolean()) });
const bindings = v.pipe(v.array(binding), v.maxLength(64), v.check(rows => new Set(rows.map(row => row.id)).size === rows.length));
const resources = v.strictObject({ geometry: bindings, reads: v.exactOptional(bindings), objects: v.exactOptional(bindings),
  textures: v.exactOptional(bindings), decorators: v.exactOptional(bindings),
  repeats: v.exactOptional(v.pipe(v.array(v.strictObject({ id: name,
    value: v.tuple([v.pipe(v.number(), v.finite(), v.minValue(-1e5), v.maxValue(1e5)), v.pipe(v.number(), v.finite(), v.minValue(-1e5), v.maxValue(1e5))]) })),
  v.maxLength(32), v.check(rows => new Set(rows.map(row => row.id)).size === rows.length))) });

/** Admit typed JSON recipes before constructing a held scene; retain the exact authored playback and scene rows. */
export function admitHeldRecipe<Row extends HeldMeleeRecipe>(row: Row): Row {
  const phases = parseHeldMeleePhase(row.phases), scene = parsePrivateScene(row.scene);
  const channels = [...phases.phases.map(phase => phase.channel),
    ...(phases.mode === 'immediate' ? [phases.secondary.phase.channel] : []),
    ...(phases.mode === 'delayed' ? Object.values(phases.channels) : [])];
  if (channels.some(channel => !Object.hasOwn(row.playback, channel))) throw new Error('Missing held playback channel');
  if (row.restingGroup !== undefined && !scene.nodes.some(node => node.id === row.restingGroup)) throw new Error('Missing held resting part');
  for (const programs of Object.values(row.playback)) parseClientChannels(programs);
  if (row.resources !== undefined) v.parse(resources, row.resources);
  const attachments = row.attachments ?? [];
  if (attachments.length > 16 || new Set(attachments.map(part => part.id)).size !== attachments.length) throw new Error('Invalid held attachments');
  for (const attachment of row.attachments ?? []) {
    parsePrivateScene(attachment.row);
    if (attachment.resources !== undefined) v.parse(resources, attachment.resources);
  }
  if (row.caught !== undefined && !parsePrivateScene(row.caught.row).nodes.some(node => node.id === row.caught?.part)) throw new Error('Missing held caught part');
  parseWorldSceneBindings({ ...(row.tip === undefined ? {} : { tip: { kind: 'vector', value: row.tip } }),
    ...(row.restingGroup === undefined ? {} : { resting: { kind: 'group', part: row.restingGroup } }),
    ...(row.caught === undefined ? {} : { caught: { kind: 'mesh', part: row.caught.part } }) });
  return row;
}
