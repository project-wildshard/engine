import { BufferAttribute, BufferGeometry } from 'three';
import { GeometryPackData } from '@wildshard/format/geometryPack';

/** Native geometry projection over the renderer-free packed byte codec. */
export class GeometryPack extends GeometryPackData {
  /** Bind fresh decoded arrays to native geometry without sharing mutable storage. */
  geometry(i: number): BufferGeometry {
    const data = this.read(i), geometry = new BufferGeometry();
    for (const attribute of data.attributes) geometry.setAttribute(attribute.name, new BufferAttribute(attribute.array, attribute.size));
    if (data.index !== null) geometry.setIndex(new BufferAttribute(data.index, 1));
    for (const group of data.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    return geometry;
  }
}
