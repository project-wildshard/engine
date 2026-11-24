import {expect,it} from 'vitest';
import {Synth} from '../src/client/engine/audio/synth';
import {parseAudioData} from '@wildshard/format/audio';
import {requireAudioProfile} from '@wildshard/engine/audio/audioProfiles';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder';
import {builtFolder} from '../src/test/game/builtFolder';
import replay from './fixtures/nalati-call-phrases.json' with {type:'json'};

// ZONE-SNAPSHOTS ZS10 (J507): Nalati's live pin, whose synth rows are the ones the replay recorded.
const audio=(await loadHeadlessFolder(builtFolder('nalati-grasslands'))).section('audio/audio');

/** Native argument recorder. Burst consumes the same noise-offset draw as Synth.burst. */
class Recorder extends Synth {
 readonly ctx={currentTime:99} as AudioContext;
 readonly sfx={} as GainNode;
 readonly ready=true;
 protected readonly noise={} as AudioBuffer;
 readonly rows:object[]=[];
 draws=0;
 constructor(private state:number){super();}
 random=():number=>{this.draws++;this.state=(Math.imul(this.state,1664525)+1013904223)>>>0;return this.state/4294967296;};
 override tone(opts:Parameters<Synth['tone']>[0]):GainNode{this.rows.push({...opts,out:'bus',kind:'tone'});return this.sfx;}
 override burst(opts:Parameters<Synth['burst']>[0]):GainNode{this.rows.push({...opts,out:'bus',kind:'burst',offset:this.random()*1.5});return this.sfx;}
}
function close(actual:unknown,expected:unknown):void {
 if(typeof expected==='number'){expect(typeof actual).toBe('number');if(typeof actual==='number')expect(actual).toBeCloseTo(expected,11);return;}
 if(Array.isArray(expected)){expect(Array.isArray(actual)).toBe(true);if(Array.isArray(actual)){expect(actual).toHaveLength(expected.length);for(let i=0;i<expected.length;i++)close(actual[i],expected[i]);}return;}
 if(expected!==null&&typeof expected==='object'){
  expect(actual).toBeTypeOf('object');if(actual===null||typeof actual!=='object')throw new Error('Missing audio operation');
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for(const key of Object.keys(expected))close(Reflect.get(actual,key),Reflect.get(expected,key));return;
 }
 expect(actual).toEqual(expected);
}
it('replays every migrated call with its original timing, argument and noise draw order',()=>{
 const rows=parseAudioData(audio.audio).synth;
 expect(Object.keys(rows??{})).toEqual(expect.arrayContaining([...new Set(replay.cases.map(row=>row.kind))]));
 for(const sample of replay.cases){
  const recorder=new Recorder(sample.seed);
  recorder.playPhrase(requireAudioProfile(rows?.[sample.kind],sample.kind),recorder.sfx,{at:replay.at},recorder.random);
  close(recorder.rows,sample.rows);expect(recorder.draws,sample.kind).toBe(sample.draws);
 }
});
it('retains the native sheep graph and refuses a missing declared call',()=>{
 const rows=parseAudioData(audio.audio).synth;
 expect(rows?.['sheep_bleat']?.steps.some(step=>step.kind==='gainLfo')).toBe(true);
 expect(()=>requireAudioProfile(rows?.['missing'],'missing')).toThrow('missing');
});
