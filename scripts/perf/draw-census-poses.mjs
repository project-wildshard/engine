/** @typedef {{n:number,name:string,probe?:{x:number,y?:number,z:number,yaw:number,pitch:number},feet?:readonly number[],yaw:number,pitch:number}} CensusCamera */

const goldenShards = ['driftwood-isle', 'nalati-grasslands', 'far-reach', 'sunscar-dunes'];

/** Every card enters by its one ENTER WORLD (the shardfile, G531; QD7 LD5
 * removed the LEGACY / SHARDFILE pair); a locked card's label is refused.
 * @param {string} primary */
export function censusEntry(primary) {
  if (primary.trim() === 'Enter world') return '.ws-menu-play';
  throw new Error('Requested census entry is unavailable');
}

/** Measure the shardfile (the LEGACY leg is gone, QD7 LD5); the other shards use golden camera 1.
 * The CLI lends its authored table; importing this pure selector needs no art.
 * @param {string} slug @param {string} pinePose @param {string} mode
 * @param {Readonly<Record<string, readonly CensusCamera[]>>} [cameras]
 * @param {string} [ninePose] */
export function censusSelection(slug = '', pinePose = 'Q4', mode = 'shardfile', cameras = {}, ninePose = 'P4') {
  if (!['P4', 'P5'].includes(ninePose)) throw new Error('Unknown Nine census pose');
  if (!['P1', 'Q4'].includes(pinePose)) throw new Error('Unknown Pine census pose');
  if (mode === 'legacy' || mode === 'both') throw new Error('The LEGACY census leg is gone (QD7 LD5); use --mode=shardfile');
  if (mode !== 'shardfile') throw new Error('Unknown census mode');
  if (slug !== '' && !['nine-dragon-stack', 'pine-hollow', ...goldenShards].includes(slug)) throw new Error('Unknown census shard');
  const defaults = [
    { slug: 'nine-dragon-stack', poseName: ninePose, pose: ninePose === 'P5'
      ? { x: 76, y: 146, z: 6, yaw: -90 * (Math.PI / 180), pitch: 4 * (Math.PI / 180) }
      : { x: 76, y: 146, z: 6, yaw: Math.PI / 2, pitch: -10 * Math.PI / 180 } },
    { slug: 'pine-hollow', poseName: pinePose, pose: pinePose === 'P1'
      ? { x: 0, z: -235, yaw: Math.PI, pitch: 0 }
      : { x: 0, z: -28, yaw: Math.PI / 2, pitch: -4 * Math.PI / 180 } },
  ];
  if (goldenShards.includes(slug)) {
    const declared = cameras[slug];
    const camera = Array.isArray(declared) ? declared[0] : undefined;
    if (!camera || camera.n !== 1) throw new Error('Missing golden census camera 1');
    const pose = camera.probe ?? (camera.feet ? {
      x: camera.feet[0], y: camera.feet[1], z: camera.feet[2],
      yaw: -camera.yaw * Math.PI / 180, pitch: camera.pitch * Math.PI / 180,
    } : undefined);
    if (!pose || ![pose.x, pose.z, pose.yaw, pose.pitch].every(Number.isFinite)) throw new Error('Golden camera is not a standing pose');
    return [{ slug, poseName: `P1:${camera.name}`, pose, modes: [mode] }];
  }
  return defaults.filter(row => slug === '' || row.slug === slug).map(row => Object.assign(row, { modes: [mode] }));
}
