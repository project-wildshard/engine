import { Mesh, type BufferGeometry, type Group, type Material, type Object3D } from 'three';
import type { CreatureBody } from '@wildshard/format/creatureLayers';
import type { ShardRows } from '@wildshard/format/rows';
import type { SpeciesAttachment } from '@wildshard/engine/entities/creatureAttachments';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';
import { bodyContract } from '../../../shared/game/shardfile/creatureContract';

/** ONE-FORMAT CC30c: every library GLB a body's attachments draw, for the page to lease before the kit stage. */
export function attachmentRefs(rows: Pick<ShardRows, 'species'>): readonly string[] {
  return [...new Set(rows.species.flatMap(row => (row.body?.attachments ?? []).flatMap(item => item.meshes.map(part => part.geometry))))];
}

function geometryOf(model: Group | undefined): BufferGeometry {
  let found: BufferGeometry | undefined;
  model?.traverse((node: Object3D) => { if (found === undefined && node instanceof Mesh) found = node.geometry as BufferGeometry; });
  if (found === undefined) throw new Error('Unloaded creature attachment geometry');
  return found;
}

/** An attachment with its `when` and break channel, when it has them. */
function shown(row: Omit<SpeciesAttachment, 'when' | 'part'>, when: SpeciesAttachment['when'], part: number | undefined): SpeciesAttachment {
  return { ...row, ...(when === undefined ? {} : { when }), ...(part === undefined ? {} : { part }) };
}

/**
 * A body's attachments for its page look: each socket resolved to its bone and offset (a skeleton contract's socket, or a
 * GLB rig's own bone), each part to its leased geometry and compiled material, `when` and `part` to channel indices in
 * the body's `channels` (the wire's order). The phone tier drops `desktop` ones.
 */
export function speciesAttachments(body: CreatureBody, models: ReadonlyMap<string, Group>, materials: ReadonlyMap<string, Material>, phone: boolean): readonly SpeciesAttachment[] {
  const sockets = bodyContract(body)?.sockets, channels = (body.channels ?? []).map(channel => channel.name);
  const channel = (name: string): number => { const index = channels.indexOf(name); if (index === -1) throw new Error(`Undeclared creature channel ${name}`); return index; };
  return (body.attachments ?? []).filter(row => !(phone && row.desktop === true)).map((row): SpeciesAttachment => {
    const socket = sockets === undefined ? { bone: row.socket, at: [0, 0, 0] as const } : sockets[row.socket];
    if (socket === undefined) throw new Error(`Unknown creature attachment socket ${row.socket}`);
    const offset = row.at ?? [0, 0, 0], breaks = row.part === undefined ? undefined : body.volumes?.find(volume => volume.part === row.part)?.channel;
    if (row.part !== undefined && breaks === undefined) throw new Error(`Creature attachment part ${row.part} has no break channel`);
    const meshes = row.meshes.map(part => {
      const material = materials.get(part.material); if (material === undefined) throw new Error(`Missing creature attachment material ${part.material}`);
      return { id: part.id, geometry: geometryOf(models.get(part.geometry)), material };
    });
    const at: [number, number, number] = [socket.at[0] + offset[0], socket.at[1] + offset[1], socket.at[2] + offset[2]];
    return shown({ id: row.id, bone: socket.bone, at, meshes }, row.when === undefined ? undefined : { index: channel(row.when.channel), at: row.when.at ?? 0.5 },
      breaks === undefined ? undefined : channel(breaks));
  });
}

/** Each look of a species whose body hangs attachments carries them. */
export function withAttachments(looks: readonly SpeciesLook[], rows: Pick<ShardRows, 'species'>, models: ReadonlyMap<string, Group>, materials: ReadonlyMap<string, Material>, phone: boolean): readonly SpeciesLook[] {
  return looks.map(look => {
    const body = rows.species.find(row => row.id === look.species)?.body;
    if (body?.attachments === undefined) return look;
    const attachments = speciesAttachments(body, models, materials, phone);
    return attachments.length === 0 ? look : { ...look, attachments };
  });
}
