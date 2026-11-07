import type { InferOutput } from 'valibot';
import type { AnimalRigContext } from '@wildshard/engine/entities/animalRig';
import { lookAngles } from '@wildshard/engine/entities/species/rigs';
import type { LookFrameSchema } from '@wildshard/format/speciesLooks';
import { installChannelPrograms, numericCreaturePose } from './channelPrograms';

type LookFrameRow = InferOutput<typeof LookFrameSchema>;
interface FrameRig { frame: AnimalRigContext; look: { yaw: number; pitch: number }; surface: { ground: number; alive: number }; visual: { yOffset: number };
  draw: ReturnType<typeof installChannelPrograms>; observe: ReturnType<typeof installChannelPrograms> }
/** A packed look's channel frame (`LookFrameSchema`): each animal's rig copy is made on its first frame; the surface group
 *  reads the ground under it and publishes the smoothed fields, the death floor and the body's lift, then the observe group
 *  and the pose group run over the copy. */
export function creatureFrame(row: LookFrameRow, groundHeight: (x: number, z: number) => number): (context: AnimalRigContext) => void {
  const { programs, smooth, floor, look: [eye, maxYaw, maxPitch] } = row;
  if (programs.filter(program => program.numeric?.group === row.observe).length > 32) throw new Error('Excess look frame observation programmes');
  for (const program of programs) {
    const numeric = program.numeric; if (numeric?.group !== row.observe && numeric?.group !== row.surface) continue;
    if (numeric.outputs.some(out => out.path.length !== 1 || out.target !== 'mem' && !(numeric.group === row.surface && out.target === 'visual' && out.path[0] === 'yOffset'))) throw new Error('Look frame programmes must target private visual fields');
  }
  const pose = numericCreaturePose({ group: row.pose, programs: programs.filter(program => program.numeric?.group === row.pose) });
  const rigs = new WeakMap<AnimalRigContext['bones'], FrameRig>();
  return (c): void => {
    let rig = rigs.get(c.bones);
    if (rig === undefined) {
      const frame: AnimalRigContext = { ...c, mem: { ...row.memory } }, look = { yaw: 0, pitch: 0 }, surface = { ground: 0, alive: 1 }, visual = { yOffset: 0 };
      for (const program of programs) for (const output of program.numeric?.outputs ?? []) if (output.target === 'mem') {
        const key = output.path[0]; if (typeof key !== 'string') throw new Error('Missing look frame field'); frame.mem[key] = 0;
      }
      for (const field of smooth) frame.mem[field.input] = 0;
      frame.mem[floor.lift] = 0;
      const owners = new Map<string, unknown>([['frame', frame], ['mem', frame.mem], ['look', look], ['surface', surface], ['visual', visual]]);
      rig = { frame, look, surface, visual, draw: installChannelPrograms(programs, row.surface, owners), observe: installChannelPrograms(programs, row.observe, owners) };
      rigs.set(c.bones, rig);
    }
    const { frame, look, surface, visual, draw, observe } = rig, memory = frame.mem;
    Object.assign(frame, c); frame.mem = memory; Object.assign(memory, c.mem);
    for (const field of smooth) { const value = c.mem[field.input] ?? 0; memory[field.input] = value; memory[field.output] = c.mem[field.output] ?? field.initial ?? value; }
    memory[floor.death] = c.mem[floor.death] ?? 0; memory[floor.lift] = c.mem[floor.lift] ?? 0;
    surface.ground = groundHeight(c.animal.position.x, c.animal.position.z); surface.alive = Number(c.alive); Object.assign(look, lookAngles(c, eye, maxYaw, maxPitch));
    draw.evaluate({ time: c.t, delta: c.dt, values: {} });
    for (const field of smooth) c.mem[field.output] = memory[field.output] ?? 0;
    if (!c.alive) c.mem[floor.death] = memory[floor.death] ?? 0;
    c.animal.yOffset = visual.yOffset;
    observe.evaluate({ time: c.t, delta: c.dt, values: {} }); pose(frame);
  };
}
