import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Frustum, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Sphere, Vector3 } from 'three';
import { cullIntoSteps, cullPlanSteps, finishRoadSteps, roadResident, type CullPlan } from './roadCull';

function fixture(main = true) {
  const geometry = new BufferGeometry(), positions: number[] = [], indices: number[] = [];
  for (const x of [-900, -300, 0, 300, 900]) for (const z of [-900, 0, 900]) {
    const n = positions.length / 3;
    positions.push(x,0,z, x+1,0,z, x+1,0,z+1, x,0,z+1);
    indices.push(n,n+1,n+2, n,n+2,n+3);
  }
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(indices);
  const mesh = new Mesh(geometry, new MeshBasicMaterial()), camera = new PerspectiveCamera(65,1,.1,2400);
  mesh.position.set(17,3,-21); mesh.rotation.y = .2; mesh.updateMatrixWorld();
  const plans = new Map<Mesh,CullPlan>();
  finishRoadSteps(cullIntoSteps({ pitch: 500, plans, ...(main ? { camera: () => camera } : {}) }, mesh, [{distance:150,cell:4},{distance:450,cell:12}]));
  const plan = plans.get(mesh); if (plan === undefined) throw new Error('Missing road plan');
  const scene = new Scene(), draw = mesh.onBeforeRender.bind(mesh);
  return { mesh, camera, plan, render: (view: PerspectiveCamera = camera) => {
    view.updateMatrixWorld();
    Reflect.apply(draw,mesh,[null,scene,view,geometry,mesh.material,null]);
  }, dispose: () => { geometry.dispose(); mesh.material.dispose(); } };
}

// Original selection/key/index publication from 8551eaa9f9, kept independent
// of the reused live scratch so visibility and LOD transitions stay differential.
function original(plan: CullPlan, matrixWorld: Matrix4) {
  let key = '', version = 0;
  const full: number[] = [];
  for (const bin of plan.bins) full.push(...plan.source.subarray(bin.start,bin.start+bin.count));
  let drawn = full;
  return (camera: PerspectiveCamera) => {
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const sphere = new Sphere(), eye = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    const runs: {start:number;count:number;id:number}[] = [];
    plan.bins.forEach((bin,k) => {
      if (!frustum.intersectsSphere(sphere.copy(bin.sphere).applyMatrix4(matrixWorld))) return;
      const distance = sphere.distanceToPoint(eye);
      let level = 0; while (level < plan.lod.length && distance > (plan.lod[level] ?? Infinity)) level++;
      const run = level === 0 ? bin : bin.levels[level-1] ?? bin;
      runs.push({start:run.start,count:run.count,id:k*4+level});
    });
    const next = runs.map(run => run.id).join(',');
    let changed = false;
    if (next !== key) {
      changed = true; key = next; drawn = [];
      for (const run of runs) drawn.push(...plan.source.subarray(run.start,run.start+run.count));
      if (drawn.length > 0) version++;
    }
    return {drawn,version,changed};
  };
}

test('road draw scratch preserves original indices, LOD, empty views and upload decisions', () => {
  const f = fixture(), oracle = original(f.plan,f.mesh.matrixWorld);
  let update: {start:number;count:number} | undefined;
  const slices = vi.spyOn(f.plan.source,'subarray');
  try {
    const poses = [[4000,100,4000,5000,100,5000],[0,4,100,0,0,0],[0,4,100,0,0,0],
      [0,4,160,0,0,0],[300,15,480,0,0,0],[0,15,1000,0,0,0],[4000,100,4000,5000,100,5000],
      [4000,100,4000,5000,100,5000],[900,4,950,900,0,900]];
    for (let step = 0; step < 200; step++) {
      const pose = poses[step % poses.length]; if (pose === undefined) throw new Error('Missing camera pose');
      f.camera.position.set(pose[0] ?? 0,pose[1] ?? 0,pose[2] ?? 0);
      f.camera.lookAt(pose[3] ?? 0,pose[4] ?? 0,pose[5] ?? 0); f.camera.updateMatrixWorld();
      const expected = oracle(f.camera); slices.mockClear(); f.render();
      const index = f.mesh.geometry.getIndex(); if (index === null) throw new Error('Missing draw index');
      expect(Array.from(index.array).slice(0,f.mesh.geometry.drawRange.count)).toEqual(expected.drawn);
      expect(index.version).toBe(expected.version); expect(slices).not.toHaveBeenCalled();
      if (expected.changed && expected.drawn.length > 0) {
        const range = index.updateRanges[0]; expect(range).toEqual({start:0,count:expected.drawn.length});
        if (update !== undefined) expect(range).toBe(update);
        update = range;
      }
      // The renderer consumes/clears the update rows after uploading.
      index.clearUpdateRanges();
    }
  } finally { slices.mockRestore(); f.dispose(); }
});

test('a configured main camera ignores shadow cameras before changing shared cull scratch', () => {
  const f = fixture(), shadow = new PerspectiveCamera(50,1,.1,100);
  try {
    f.camera.position.set(0,4,100); f.camera.lookAt(0,0,0); f.render();
    const index = f.mesh.geometry.getIndex(); if (index === null) throw new Error('Missing draw index');
    const before = Array.from(index.array), range = {...f.mesh.geometry.drawRange}, version = index.version;
    shadow.position.set(4000,4000,4000); shadow.lookAt(5000,4000,5000); f.render(shadow);
    expect(Array.from(index.array)).toEqual(before); expect(f.mesh.geometry.drawRange).toEqual(range); expect(index.version).toBe(version);
    f.render(); expect(index.version).toBe(version);
  } finally { f.dispose(); }
});

// Shared vertices must be counted anew in each bin, including negative cells.
test('bin bounds keep every indexed point while sharing repeated vertex reads', () => {
  const geometry = new BufferGeometry();
  const points = [-300, 2, -300, 0, 9, 0, 300, -4, 300, 300, 7, -300];
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(points), 3));
  geometry.setIndex([0, 1, 3, 1, 2, 3, 0, 1, 3, 1, 2, 3]);
  const position = geometry.getAttribute('position'), read = vi.spyOn(position, 'getY');
  try {
    const plan = finishRoadSteps(cullPlanSteps(geometry, 500));
    expect(Array.from(plan.source)).toEqual([0, 1, 3, 0, 1, 3, 1, 2, 3, 1, 2, 3]);
    expect(plan.bins).toHaveLength(2);
    for (const bin of plan.bins) {
      const vertices = Array.from(plan.source.subarray(bin.start, bin.start + bin.count), n => new Vector3().fromArray(points, n * 3));
      const originalSphere = new Sphere().setFromPoints(vertices);
      expect(bin.sphere.center.toArray()).toEqual(originalSphere.center.toArray());
      expect(bin.sphere.radius).toBe(originalSphere.radius);
    }
    // Three distinct vertices per bin, once for the box and once for radius.
    expect(read).toHaveBeenCalledTimes(12);
  } finally { read.mockRestore(); geometry.dispose(); }
});

test('the resident census counts a road mesh with no index or position yet as drawing nothing', () => {
  // T7 / S3 plan-end reading (b6423e3cdb): a road mesh still being painted in steps threw on its missing position
  const root = new Scene(), painted = new BufferGeometry();
  painted.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  root.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()), new Mesh(painted, new MeshBasicMaterial()));
  expect(roadResident([root])).toMatchObject({ meshes: 2, triangles: 1 });
});
