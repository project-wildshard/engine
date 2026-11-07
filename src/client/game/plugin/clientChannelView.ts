// Client-only private presentation math. Pure CPU; shared by views and build
// generators so their initial poses and instance matrices cannot drift.
import { BufferAttribute, BufferGeometry, InstancedMesh, Material, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { compileTubeCurve, parseClientChannels, type ClientChannelProgram } from '@wildshard/format/clientChannels';
import type { MoverPose } from '@wildshard/engine/physics/mover';
import { createClientChannels, type ClientTubeFrame, type ClientConnectorFrame, type ClientChannelObservation } from '../../../shared/game/plugin/channels';

function clientInstance(value: unknown): value is InstancedMesh {
  return value instanceof InstancedMesh && value.geometry instanceof BufferGeometry
    && (Array.isArray(value.material) ? value.material.every((material: unknown) => material instanceof Material) : value.material instanceof Material);
}

/** Bind one bounded writer to the caller's existing object or instance slots. No geometry, body or clock is allocated. */
function clientConnector(row: NonNullable<ClientChannelProgram['connectors']>[number], target: unknown,
  changed: (mesh: InstancedMesh) => void): (frame: ClientConnectorFrame) => void {
  if (!(target instanceof Object3D)) throw new Error('Connector target must be a private scene object');
  const span = row.instances;
  if (span !== undefined && (!(clientInstance(target)) || span.start + span.capacity > target.count))
    throw new Error('Connector instance slots exceed the borrowed mesh');
  if (span === undefined && clientInstance(target)) throw new Error('Connector instances require explicit slots');
  const mesh = clientInstance(target) ? target : undefined;
  const matrix = new Matrix4(), quaternion = new Quaternion(), turned = new Quaternion(), rotation = new Quaternion();
  const axis = new Vector3(...(row.aim ?? [0, 1, 0])), direction = new Vector3(), point = new Vector3(), scale = new Vector3();
  const zero = new Vector3(), identity = new Quaternion(), hidden = new Matrix4().compose(zero, identity, zero);
  const turnAxis = new Vector3(...(row.turn?.axis ?? [0, 1, 0]));
  let initialized = false, previous = Number.NaN, enabled = false;
  return frame => {
    const on = frame.enabled !== 0;
    if (initialized && row.cache !== undefined && frame.cache === previous && on === enabled) return;
    if (row.cache !== undefined && frame.cache === undefined) throw new Error('Missing connector cache output');
    if (mesh !== undefined && !on) {
      for (let index = 0; index < (span?.capacity ?? 0); index++) mesh.setMatrixAt((span?.start ?? 0) + index, hidden);
    } else {
      direction.set(frame.toX - frame.fromX, frame.toY - frame.fromY, frame.toZ - frame.fromZ);
      const length = direction.length(); direction.normalize();
      if (row.aim === undefined) quaternion.identity(); else quaternion.setFromUnitVectors(axis, direction);
      if (row.turn !== undefined) {
        turned.setFromAxisAngle(turnAxis, row.turn.radians);
        if (row.aim !== undefined) turned.premultiply(quaternion);
      } else turned.copy(quaternion);
      const count = span?.capacity ?? 1;
      const visible = span?.pitch === undefined ? count : Math.min(count, Math.max(1, Math.floor(length / span.pitch)));
      scale.set(frame.scaleX, frame.scaleY, frame.scaleZ);
      for (let index = 0; index < count; index++) {
        if (mesh !== undefined && index >= visible) { mesh.setMatrixAt((span?.start ?? 0) + index, hidden); continue; }
        rotation.copy(row.turn === undefined || row.turn.alternate && index % 2 === 0 ? quaternion : turned);
        if (span?.pitch === undefined) point.set(frame.atX, frame.atY, frame.atZ);
        else point.set(frame.toX, frame.toY, frame.toZ).addScaledVector(direction, -(index + 0.5) * (length / visible));
        if (mesh !== undefined) mesh.setMatrixAt((span?.start ?? 0) + index, matrix.compose(point, rotation, scale));
        else { target.position.copy(point); target.quaternion.copy(rotation); target.scale.copy(scale); target.visible = on; }
      }
    }
    if (mesh !== undefined) changed(mesh);
    initialized = true; previous = frame.cache ?? Number.NaN; enabled = on;
  };
}

/** A detached visual observation; only these numeric values and the clock cross the presentation boundary. */
/** A trusted private view supplies its own declared geometry kernel; admission never accepts a function. */
export type ClientGeometryKernels = ReadonlyMap<string, (row: NonNullable<ClientChannelProgram['geometry']>, target: unknown) => (frame: ClientTubeFrame, time: number) => void>;

function bindTubeCurve(row: NonNullable<ClientChannelProgram['geometry']>, target: unknown): (frame: ClientTubeFrame,time:number)=>void {
  if(!(target instanceof Mesh))throw new Error('Tube target requires its owned mesh');
  const candidate: unknown=target.geometry;
  if(!(candidate instanceof BufferGeometry))throw new Error('Tube target requires its owned geometry');
  const geometry=candidate,position:unknown=geometry.getAttribute('position'),attributes:unknown=geometry.attributes;
  if(attributes===null||typeof attributes!=='object')throw new Error('Missing tube attributes');
  if(position===undefined&&Object.keys(attributes).length===0&&geometry.index===null)return ()=>undefined;
  const tube=compileTubeCurve({segments:row.segments,radial:row.radial,bend:row.bend,ripple:row.ripple,drop:row.drop,radius:row.radius});
  if(!(position instanceof BufferAttribute)||!(position.array instanceof Float32Array)||position.itemSize!==3||position.count!==tube.vertices)throw new Error('Tube mesh layout differs');
  const positions=position.array;
  return (frame,time)=>{tube.write(positions,frame,time);position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();};
}

const CLIENT_SCALAR_TRANSFORMS = { x: ['position', 'x'], y: ['position', 'y'], z: ['position', 'z'],
  pitch: ['rotation', 'x'], yaw: ['rotation', 'y'], roll: ['rotation', 'z'],
  scaleX: ['scale', 'x'], scaleY: ['scale', 'y'], scaleZ: ['scale', 'z'] } as const;

/** Bind admitted numeric outputs only to named private scene objects; authoritative player/shared objects refuse. */
export function createClientChannelView(input: unknown, targets: ReadonlyMap<string, unknown>, kernels?: ClientGeometryKernels, changed?: (mesh: InstancedMesh) => void): ReturnType<typeof createClientChannels> {
  const program = parseClientChannels([input])[0];
  if (program === undefined || program.bindings === undefined && program.geometry === undefined && program.connectors === undefined) throw new Error('Missing visual channel bindings');
  let curve: ((frame: ClientTubeFrame, time: number) => void) | undefined;
  if (program.geometry !== undefined) {
    const target = targets.get(program.geometry.target), kernel = kernels?.get(program.geometry.target);
    if (!(target instanceof Object3D)) throw new Error('Geometry target must be a private scene object');
    curve = kernel === undefined ? bindTubeCurve(program.geometry, target) : kernel(program.geometry, target);
  }
  const lane = createClientChannels(program);
  const bindings = (program.bindings ?? []).map(binding => {
    const object = targets.get(binding.target);
    if (!(object instanceof Object3D)) throw new Error('Client channel target must be a private scene object');
    const numeric = binding.property === 'visible' ? null : lane.bindNumeric([{ property: binding.property, target: binding.target, path: CLIENT_SCALAR_TRANSFORMS[binding.property] }], targets);
    return { property: binding.property, target: binding.target, order: binding.order, object, numeric };
  });
  const pending = new Set<InstancedMesh>();
  const poses = (program.connectors ?? []).map(row => clientConnector(row, targets.get(row.target), mesh => { pending.add(mesh); }));
  const evaluate = (observation: ClientChannelObservation): void => {
    lane.evaluate(observation);
    for (const [index, pose] of poses.entries()) {
      const frame = lane.connectors?.[index]; if (frame === undefined) throw new Error('Missing connector outputs'); pose(frame);
    }
    for (const mesh of pending) { if (changed === undefined) mesh.instanceMatrix.needsUpdate = true; else changed(mesh); }
    pending.clear();
    if (curve !== undefined) { if (lane.geometry === undefined) throw new Error('Missing tube outputs'); curve(lane.geometry, observation.time); }
    for (const binding of bindings) {
      const { object, property, order } = binding, value = lane.frame[property];
      if (value === undefined) throw new Error('Missing bound visual channel');
      if (order !== undefined) object.rotation.order = order;
      if (binding.numeric === null) object.visible = value !== 0;
      else binding.numeric.apply(lane.frame);
    }
  };
  return Object.freeze({ bindNumeric: lane.bindNumeric, reads: lane.reads, frame: lane.frame, evaluate,
    // a view that toggles a node's visibility may be what shows a hidden model again: never skippable
    stateless: lane.stateless && bindings.every(binding => binding.numeric !== null), toggles: bindings.some(binding => binding.numeric === null),
    ...(lane.connectors === undefined ? {} : { connectors: lane.connectors }) });
}

/** Copy only the fixed mover ABI's published observations, never its world or module memory. */
export function moverChannelValues(reads: readonly string[], pose: MoverPose, fields: Readonly<Record<number, number>>): number[] {
  return reads.map(read => {
      if (read === 'enabled') return Number(pose.enabled);
      if (read.startsWith('position.')) {
        const axis = read.slice(9); if (axis === 'x' || axis === 'y' || axis === 'z') return pose.position[axis];
      }
      if (read.startsWith('euler.')) {
        const axis = read.slice(6); if (axis === 'x' || axis === 'y' || axis === 'z') return pose.euler[axis];
      }
      const field = /^field\.([1-6])$/u.exec(read), key = field?.[1];
      const value = key === undefined ? undefined : fields[Number(key)];
      if (value === undefined) throw new Error('Missing copied mover field');
      return value;
  });
}
